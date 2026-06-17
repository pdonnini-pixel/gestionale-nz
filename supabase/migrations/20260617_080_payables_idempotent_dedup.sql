-- ════════════════════════════════════════════════════════════════════
-- 080 — Import passivi idempotenti + dedup robusta + company multi-tenant
-- Applicata ai 3 tenant (NZ/Made/Zago). Costruisce sopra 079 (scadenza a vista).
--
-- CAUSA (verificata): il re-sync A-Cube creava payable duplicati perché:
--  - le rate 2..n erano inserite senza acube_uuid e con `ON CONFLICT DO NOTHING`
--    senza target utile → non idempotenti;
--  - la dedup (fn_prevent_duplicate_payable) usava (company, invoice_number,
--    COALESCE(installment_number,0), fornitore): al cambio di rappresentazione
--    (rata unica con installment_number NULL → N rate 1..n, o scadenze ricalcolate)
--    le rate risultavano "nuove" → cloni con stesso electronic_invoice_id ma
--    installment_number/due_date diversi;
--  - company_id = `companies LIMIT 1` (errato su DB multi-company).
--
-- FIX:
--  1) Chiave logica stabile: (company_id, electronic_invoice_id,
--     COALESCE(installment_number,1)). installment_number SEMPRE valorizzato
--     (rata unica = 1). due_date MAI nella chiave di dedup.
--  2) Idempotenza centralizzata nel trigger BEFORE INSERT fn_prevent_duplicate_payable
--     (chokepoint unico per sync A-Cube, fn_invoice_to_payable, inserimenti manuali):
--     se esiste già → UPDATE dei soli dati di import/anagrafica (preserva
--     status, amount_paid, payment_date, riconciliazione, note) e blocca l'INSERT.
--     Fallback chiave senza fattura elettronica: invoice_number + installment + fornitore.
--  3) Indice unico parziale di backstop su (company_id, electronic_invoice_id,
--     COALESCE(installment_number,1)) WHERE electronic_invoice_id IS NOT NULL
--     AND status IS DISTINCT FROM 'annullato'.
--  4) Company risolta dalla P.IVA destinataria (recipient_vat → companies.vat_number);
--     fallback DB mono-company; altrimenti skip + warning (mai company sbagliata).
-- ════════════════════════════════════════════════════════════════════

-- 1) Dedup chokepoint unico
CREATE OR REPLACE FUNCTION public.fn_prevent_duplicate_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  existing_id uuid; existing_status text;
BEGIN
  -- Forecast/ricorrenti: nessuna dedup automatica (gestione manuale)
  IF NEW.is_forecast IS TRUE OR NEW.recurring_cost_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.electronic_invoice_id IS NOT NULL THEN
    SELECT id, status::text INTO existing_id, existing_status
    FROM payables
    WHERE company_id = NEW.company_id
      AND electronic_invoice_id = NEW.electronic_invoice_id
      AND COALESCE(installment_number,1) = COALESCE(NEW.installment_number,1)
    ORDER BY (status='annullato')::int ASC,
             (COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale'))::int DESC,
             created_at ASC
    LIMIT 1;
  ELSIF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN
    SELECT id, status::text INTO existing_id, existing_status
    FROM payables
    WHERE company_id = NEW.company_id
      AND electronic_invoice_id IS NULL
      AND invoice_number = NEW.invoice_number
      AND COALESCE(installment_number,1) = COALESCE(NEW.installment_number,1)
      AND (
        (supplier_id IS NOT NULL AND supplier_id = NEW.supplier_id)
        OR (supplier_vat IS NOT NULL AND supplier_vat <> '' AND supplier_vat = NEW.supplier_vat)
        OR (supplier_name IS NOT NULL AND supplier_name <> '' AND supplier_name = NEW.supplier_name)
      )
    ORDER BY (status='annullato')::int ASC,
             (COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale'))::int DESC,
             created_at ASC
    LIMIT 1;
  ELSE
    RETURN NEW;
  END IF;

  IF existing_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Duplicato: aggiorna SOLO dati di import/anagrafica sulla riga canonica non
  -- annullata; preserva status, amount_paid, payment_date, riconciliazione, note.
  IF existing_status IS DISTINCT FROM 'annullato' THEN
    UPDATE payables SET
      supplier_id          = COALESCE(NEW.supplier_id, supplier_id),
      supplier_name        = COALESCE(NEW.supplier_name, supplier_name),
      supplier_vat         = COALESCE(NEW.supplier_vat, supplier_vat),
      gross_amount         = COALESCE(NEW.gross_amount, gross_amount),
      net_amount           = COALESCE(NEW.net_amount, net_amount),
      vat_amount           = COALESCE(NEW.vat_amount, vat_amount),
      due_date             = COALESCE(NEW.due_date, due_date),
      original_due_date    = COALESCE(original_due_date, NEW.original_due_date, NEW.due_date),
      payment_method       = COALESCE(NEW.payment_method, payment_method),
      payment_method_code  = COALESCE(NEW.payment_method_code, payment_method_code),
      payment_method_label = COALESCE(NEW.payment_method_label, payment_method_label),
      iban                 = COALESCE(NEW.iban, iban),
      installment_total    = COALESCE(NEW.installment_total, installment_total),
      electronic_invoice_id= COALESCE(electronic_invoice_id, NEW.electronic_invoice_id),
      acube_uuid           = COALESCE(acube_uuid, NEW.acube_uuid),
      cost_category_id     = COALESCE(cost_category_id, NEW.cost_category_id),
      updated_at           = NOW()
    WHERE id = existing_id;
  END IF;
  RETURN NULL;  -- blocca l'INSERT del duplicato (idempotenza)
END;
$function$;

-- 2) Sync A-Cube: company da P.IVA destinataria + installment_number sempre valorizzato
--    (preserva la logica 078/079: BOM strip, nome XML→JSON, net/vat payload,
--     scadenze XML→JSON, fallback "a vista" = invoice_date)
CREATE OR REPLACE FUNCTION public.sync_acube_sdi_passive_to_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_company_id uuid; v_supplier_id uuid; v_electronic_invoice_id uuid; v_name text;
  n int; sum_rate numeric; tol numeric; i int; v_dues date[]; v_amts numeric[]; v_mets text[];
  v_net numeric; v_vat numeric; v_realxml text; v_xml text; v_due_fallback date;
begin
  if NEW.direction <> 'passive' then return NEW; end if;

  -- Tenant corretto: P.IVA destinataria → company; fallback DB mono-company; altrimenti skip+log
  select id into v_company_id from public.companies
   where NEW.recipient_vat is not null
     and regexp_replace(coalesce(vat_number,''),'\D','','g') = regexp_replace(NEW.recipient_vat,'\D','','g')
   limit 1;
  if v_company_id is null and (select count(*) from public.companies) = 1 then
    select id into v_company_id from public.companies limit 1;
  end if;
  if v_company_id is null then
    raise warning '[sync_acube_sdi_passive] company non risolta (recipient_vat=%, acube_uuid=%)', NEW.recipient_vat, NEW.acube_uuid;
    return NEW;
  end if;

  v_realxml := ltrim(NEW.xml_content, chr(65279) || E' \t\r\n');
  if v_realxml is null or left(v_realxml,1) <> '<' then v_realxml := null; end if;
  v_name := NEW.sender_name;
  if v_name is null or v_name ~ '^[0-9]+$' or v_name = NEW.sender_vat then
    v_name := public._acube_extract_cedente_name(v_realxml, NULL);
  end if;
  if v_name is null or v_name ~ '^[0-9]+$' or v_name = NEW.sender_vat then
    v_name := public._acube_cedente_name_json(NEW.payload, NEW.sender_vat);
  end if;
  select coalesce(sum((r->>'imponibile_importo')::numeric), 0), coalesce(sum((r->>'imposta')::numeric), 0)
    into v_net, v_vat
  from jsonb_array_elements(coalesce(NEW.payload->'fattura_elettronica_body', '[]'::jsonb)) body
  cross join lateral jsonb_array_elements(coalesce(body #> '{dati_beni_servizi,dati_riepilogo}', '[]'::jsonb)) r;
  if coalesce(v_net,0) = 0 and coalesce(v_vat,0) = 0 and coalesce(NEW.total_amount,0) <> 0 then
    v_net := NEW.total_amount; v_vat := 0;
  end if;
  v_xml := coalesce(v_realxml, NEW.payload::text);
  select array_agg(due_date order by installment), array_agg(amount order by installment),
         array_agg(method order by installment), count(*), coalesce(sum(amount),0)
    into v_dues, v_amts, v_mets, n, sum_rate
  from public.fn_parse_invoice_payments(v_realxml) where due_date is not null and amount is not null;
  if coalesce(n,0) = 0 then
    select array_agg(due_date order by installment), array_agg(amount order by installment),
           array_agg(method order by installment), count(*), coalesce(sum(amount),0)
      into v_dues, v_amts, v_mets, n, sum_rate
    from public.fn_parse_invoice_payments_json(NEW.payload) where due_date is not null and amount is not null;
  end if;
  v_due_fallback := NEW.invoice_date;  -- "a vista": mai +30

  select id into v_supplier_id from public.suppliers
  where company_id = v_company_id and (partita_iva = NEW.sender_vat or vat_number = NEW.sender_vat) limit 1;
  if v_supplier_id is null then
    insert into public.suppliers (id, company_id, name, ragione_sociale, vat_number, partita_iva, nazione, source, is_active, payment_terms, payment_method)
    values (gen_random_uuid(), v_company_id, v_name, v_name, NEW.sender_vat, NEW.sender_vat, coalesce(NEW.sender_country,'IT'), 'acube_sdi', true, 30, 'bonifico_ordinario')
    returning id into v_supplier_id;
  end if;

  insert into public.electronic_invoices (id, company_id, invoice_number, invoice_date, supplier_name, supplier_vat,
    net_amount, vat_amount, gross_amount, due_date, sdi_id, sdi_status, tipo_documento, source, xml_content, acube_uuid, codice_destinatario, created_at)
  values (gen_random_uuid(), v_company_id, NEW.invoice_number, NEW.invoice_date, v_name, NEW.sender_vat,
    v_net, v_vat, NEW.total_amount, coalesce(v_dues[1], v_due_fallback), NEW.sdi_file_id, public._acube_marking_to_sdi_status(NEW.marking), NEW.document_type, 'api_acube_sdi',
    v_xml, NEW.acube_uuid, NEW.recipient_code, now())
  on conflict (acube_uuid) do nothing returning id into v_electronic_invoice_id;
  if v_electronic_invoice_id is null then
    select id into v_electronic_invoice_id from public.electronic_invoices where acube_uuid = NEW.acube_uuid;
  end if;

  tol := greatest(0.05, coalesce(NEW.total_amount,0)*0.001);
  if coalesce(NEW.total_amount,0) > 0 and n is not null and n >= 2 and abs(sum_rate - NEW.total_amount) <= tol then
    v_amts[n] := round(NEW.total_amount - (select coalesce(sum(a),0) from unnest(v_amts[1:n-1]) a), 2);
    insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
      gross_amount, status, payment_method, payment_method_code, electronic_invoice_id, acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, created_at)
    values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[1], v_dues[1],
      v_amts[1], 'da_pagare'::payable_status, 'bonifico_ordinario'::payment_method, coalesce(v_mets[1], null), v_electronic_invoice_id, NEW.acube_uuid, v_name, NEW.sender_vat, 1, n, now())
    on conflict do nothing;
    for i in 2..n loop
      insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
        gross_amount, status, payment_method, payment_method_code, electronic_invoice_id, supplier_name, supplier_vat, installment_number, installment_total, created_at)
      values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[i], v_dues[i],
        v_amts[i], 'da_pagare'::payable_status, 'bonifico_ordinario'::payment_method, coalesce(v_mets[i], null), v_electronic_invoice_id, v_name, NEW.sender_vat, i, n, now())
      on conflict do nothing;
    end loop;
  else
    -- Rata unica: installment_number = 1 (chiave stabile, niente NULL)
    insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
      gross_amount, status, payment_method, payment_method_code, electronic_invoice_id, acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, created_at)
    values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date,
      coalesce(v_dues[1], v_due_fallback), coalesce(v_dues[1], v_due_fallback),
      NEW.total_amount, 'da_pagare'::payable_status, 'bonifico_ordinario'::payment_method, coalesce(v_mets[1], null), v_electronic_invoice_id, NEW.acube_uuid, v_name, NEW.sender_vat, 1, 1, now())
    on conflict do nothing;
  end if;
  return NEW;
end; $function$;

-- 3) fn_invoice_to_payable (e-invoice upload non-A-Cube): rata unica → installment 1
--    (preserva fallback "a vista" = invoice_date di 079)
CREATE OR REPLACE FUNCTION public.fn_invoice_to_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_supplier_id uuid; v_due date; n int; sum_rate numeric; tol numeric; i int; v_dues date[]; v_amts numeric[]; v_mets text[];
begin
  if NEW.acube_uuid is not null then return NEW; end if;
  select id into v_supplier_id from suppliers where company_id = NEW.company_id
    and ((NEW.supplier_vat is not null and vat_number = NEW.supplier_vat) or (NEW.supplier_name is not null and name ilike NEW.supplier_name)) limit 1;
  select array_agg(due_date order by installment), array_agg(amount order by installment), array_agg(method order by installment), count(*), coalesce(sum(amount),0)
    into v_dues, v_amts, v_mets, n, sum_rate from public.fn_parse_invoice_payments(NEW.xml_content) where due_date is not null and amount is not null;
  if coalesce(NEW.gross_amount,0) <= 0 or n is null or n = 0 then
    v_due := coalesce(NEW.due_date, NEW.invoice_date);
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, net_amount, vat_amount, gross_amount, amount_remaining, electronic_invoice_id, import_batch_id, payment_method_code, installment_number, installment_total, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_due, v_due, NEW.net_amount, NEW.vat_amount, NEW.gross_amount, NEW.gross_amount, NEW.id, NEW.import_batch_id, NEW.payment_method, 1, 1, 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
    return NEW;
  end if;
  tol := greatest(0.05, NEW.gross_amount*0.001);
  if abs(sum_rate - NEW.gross_amount) > tol then
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, net_amount, vat_amount, gross_amount, amount_remaining, electronic_invoice_id, import_batch_id, payment_method_code, installment_number, installment_total, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[1], v_dues[1], NEW.net_amount, NEW.vat_amount, NEW.gross_amount, NEW.gross_amount, NEW.id, NEW.import_batch_id, coalesce(v_mets[1], NEW.payment_method), 1, 1, 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
    return NEW;
  end if;
  if n = 1 then
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, net_amount, vat_amount, gross_amount, amount_remaining, electronic_invoice_id, import_batch_id, payment_method_code, installment_number, installment_total, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[1], v_dues[1], NEW.net_amount, NEW.vat_amount, NEW.gross_amount, NEW.gross_amount, NEW.id, NEW.import_batch_id, coalesce(v_mets[1], NEW.payment_method), 1, 1, 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
    return NEW;
  end if;
  v_amts[n] := round(NEW.gross_amount - (select coalesce(sum(a),0) from unnest(v_amts[1:n-1]) a), 2);
  for i in 1..n loop
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, gross_amount, amount_remaining, electronic_invoice_id, import_batch_id, installment_number, installment_total, payment_method_code, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[i], v_dues[i], v_amts[i], v_amts[i], NEW.id, NEW.import_batch_id, i, n, coalesce(v_mets[i], NEW.payment_method), 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
  end loop;
  return NEW;
end; $function$;

-- 4) fn_backfill_payable_installments: rata unica → installment 1; search_path fisso
CREATE OR REPLACE FUNCTION public.fn_backfill_payable_installments(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record; n int; sum_rate numeric; tol numeric; i int;
  v_dues date[]; v_amts numeric[]; v_mets text[];
  c_date int:=0; c_split int:=0; c_newrows int:=0; c_skip_inv int:=0; c_skip_paid int:=0; c_already int:=0;
  flagged jsonb := '[]'::jsonb;
begin
  for r in
    select p.id, p.company_id, p.outlet_id, p.supplier_id, p.supplier_name, p.supplier_vat,
           p.invoice_number, p.invoice_date, p.due_date, p.gross_amount, p.amount_paid, p.status::text st,
           p.cost_category_id, p.payment_method, p.payment_method_code, p.electronic_invoice_id,
           p.import_batch_id, p.notes, e.xml_content
    from public.payables p
    join public.electronic_invoices e on e.id = p.electronic_invoice_id
    where p.company_id = p_company
      and coalesce(p.installment_number,0) = 0
      and e.xml_content is not null
      and e.xml_content like '%DataScadenzaPagamento%'
  loop
    if r.gross_amount <= 0 or r.st in ('nota_credito','annullato') then continue; end if;

    select array_agg(due_date order by installment), array_agg(amount order by installment),
           array_agg(method order by installment), count(*), coalesce(sum(amount),0)
      into v_dues, v_amts, v_mets, n, sum_rate
    from public.fn_parse_invoice_payments(r.xml_content)
    where due_date is not null and amount is not null;

    if n is null or n = 0 then continue; end if;
    tol := greatest(0.05, r.gross_amount * 0.001);

    if abs(sum_rate - r.gross_amount) > tol then
      c_skip_inv := c_skip_inv + 1;
      flagged := flagged || jsonb_build_object('invoice', r.invoice_number, 'reason','invariant','gross',r.gross_amount,'sum_rate',sum_rate);
      continue;
    end if;

    if exists(select 1 from public.payables x where x.company_id=r.company_id and x.invoice_number=r.invoice_number
              and coalesce(x.installment_number,0) >= 1
              and (x.supplier_id is not distinct from r.supplier_id or x.supplier_name is not distinct from r.supplier_name)) then
      c_already := c_already + 1; continue;
    end if;

    if n = 1 then
      update public.payables set due_date=v_dues[1], original_due_date=v_dues[1],
        installment_number=1, installment_total=1,
        payment_method_code=coalesce(v_mets[1], payment_method_code), updated_at=now()
      where id=r.id;
      c_date := c_date + 1;
    else
      if coalesce(r.amount_paid,0) > v_amts[1] + tol then
        c_skip_paid := c_skip_paid + 1;
        flagged := flagged || jsonb_build_object('invoice', r.invoice_number, 'reason','paid_spans','amount_paid',r.amount_paid,'rata1',v_amts[1]);
        continue;
      end if;
      v_amts[n] := round(r.gross_amount - (select coalesce(sum(a),0) from unnest(v_amts[1:n-1]) a), 2);
      update public.payables set due_date=v_dues[1], original_due_date=v_dues[1], gross_amount=v_amts[1],
        net_amount=null, vat_amount=null, installment_number=1, installment_total=n,
        payment_method_code=coalesce(v_mets[1], payment_method_code), updated_at=now()
      where id=r.id;
      c_split := c_split + 1;
      for i in 2..n loop
        insert into public.payables (company_id, outlet_id, supplier_id, supplier_name, supplier_vat,
          invoice_number, invoice_date, due_date, original_due_date, gross_amount, amount_paid,
          cost_category_id, payment_method, payment_method_code, electronic_invoice_id, import_batch_id,
          installment_number, installment_total, status, notes, created_at, updated_at)
        values (r.company_id, r.outlet_id, r.supplier_id, r.supplier_name, r.supplier_vat,
          r.invoice_number, r.invoice_date, v_dues[i], v_dues[i], v_amts[i], 0,
          r.cost_category_id, r.payment_method, coalesce(v_mets[i], r.payment_method_code), r.electronic_invoice_id, r.import_batch_id,
          i, n, 'da_pagare'::payable_status, r.notes, now(), now());
        c_newrows := c_newrows + 1;
      end loop;
    end if;
  end loop;

  return jsonb_build_object('date_corrections',c_date,'splits',c_split,'new_rows',c_newrows,
    'skip_invariant',c_skip_inv,'skip_paid_spans',c_skip_paid,'already_split',c_already,'flagged',flagged);
end; $function$;

-- 5) Indice unico parziale di backstop (esclude le righe annullate)
CREATE UNIQUE INDEX IF NOT EXISTS payables_company_einvoice_installment_uniq
ON public.payables (company_id, electronic_invoice_id, COALESCE(installment_number,1))
WHERE electronic_invoice_id IS NOT NULL AND status IS DISTINCT FROM 'annullato';
