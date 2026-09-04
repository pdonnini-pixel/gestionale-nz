-- =============================================================================
-- 176 — RITENUTA D'ACCONTO nel bridge A-Cube SDI passivo (NZ + Made + Zago)
-- Additiva: sostituisce due funzioni, nessuna DDL sui dati.
-- =============================================================================
--
-- CASO CHE L'HA FATTA EMERGERE (NZ, 04/09/2026)
--   SIGNORINI ASSOCIATI, fattura 563 del 14/07/2026 (TD06, parcella).
--     imponibile 3.664,00 + cassa TC08 4% 146,56 = 3.810,56
--     IVA 22% 838,32 -> totale documento 4.648,88
--     ritenuta RT02 20% 732,80 -> DatiPagamento/ImportoPagamento 3.916,08
--   Il bonifico realmente uscito il 13/07/2026 e' di 3.916,08. Il gestionale
--   aveva pero' una scadenza aperta da 4.648,88: 732,80 di debito che non
--   esiste, e la fattura risultava «scaduta» mentre l'estratto conto del
--   fornitore al 03/09/2026 la dava chiusa.
--
-- DIFETTO 1 — il bridge ignora la ritenuta.
--   La deduzione viveva solo in fn_invoice_to_payable, che pero' esce subito
--   con «if NEW.acube_uuid is not null then return NEW». Da quando esiste
--   quella guardia, ogni fattura passiva A-Cube con ritenuta genera la
--   scadenza sul TOTALE DOCUMENTO invece che sull'importo da pagare.
--   sync_acube_sdi_passive_to_payable non nominava la ritenuta in nessun ramo.
--
-- DIFETTO 2 — l'aggancio notula/fattura della 098 non riconosce la coppia.
--   Il ramo (b) cerca una notula con lo stesso LORDO a +/- 0,01. La notula e'
--   registrata al netto (3.916,08), la fattura arriva al lordo (4.648,88):
--   differenza esattamente la ritenuta, nessun candidato, doppione.
--
-- COSA CAMBIA
--   A) sync_acube_sdi_passive_to_payable calcola la ritenuta con
--      fn_invoice_withholding(xml, payload) e genera le scadenze su
--      v_net_due = totale - ritenuta, valorizzando payables.withholding_amount.
--      Ramo N rate: accetta rate che sommano al netto (caso normale con
--      ritenuta) oltre che al lordo; se sommano al lordo le riproporziona,
--      come gia' fa fn_invoice_to_payable. La ritenuta e' ripartita fra le
--      rate, il residuo di arrotondamento sull'ultima.
--      Ramo piano fornitore e ramo fallback: stessa logica sul netto.
--      Con ritenuta = 0 (la quasi totalita' delle fatture) v_net_due coincide
--      con il totale: comportamento identico a prima, bit per bit.
--   B) fn_prevent_duplicate_payable, ramo (b): la notula candidata puo'
--      combaciare con il lordo della riga in arrivo OPPURE con quel lordo
--      piu' la ritenuta (notula registrata al netto, o al totale documento).
--      Resta la regola di sicurezza: si fonde solo se la candidata e' UNA.
--
-- NON TOCCATO di proposito: il ramo note di credito (TD04/TD08), che continua
-- a usare il totale documento. Le NC con ritenuta sono rare e la compensazione
-- NC ha una sua logica: se ne riparla quando ne arriva una vera.
--
-- VERIFICA: nessuna fattura passiva gia' a sistema cambia da sola (le funzioni
-- agiscono solo sui nuovi INSERT). Il pregresso NZ e' un caso solo, sistemato
-- con NZ_ONLY_20260904_176.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- A) bridge SDI passivo: scadenze al netto della ritenuta d'acconto
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_acube_sdi_passive_to_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
declare
  v_company_id uuid; v_supplier_id uuid; v_electronic_invoice_id uuid; v_name text;
  n int; sum_rate numeric; tol numeric; i int; v_dues date[]; v_amts numeric[]; v_mets text[];
  v_net numeric; v_vat numeric; v_realxml text; v_xml text; v_due_fallback date;
  v_pb text; v_prima int; v_nrate int; v_bank uuid; v_smethod text; rec record;
  v_is_nc boolean;
  v_tp text;
  v_method public.payment_method;
  v_note text;
  -- ritenuta d'acconto
  v_payload jsonb; v_wh numeric := 0; v_net_due numeric;
  v_whs numeric[]; v_wh_acc numeric := 0; v_row_wh numeric;
begin
  if NEW.direction <> 'passive' then return NEW; end if;
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

  -- ── ritenuta d'acconto (RT01/RT02/...): l'importo davvero da pagare e' il
  --    totale documento meno la ritenuta trattenuta dal committente.
  v_payload := case when jsonb_typeof(NEW.payload) = 'object' then NEW.payload else null end;
  v_wh := coalesce(public.fn_invoice_withholding(v_realxml, v_payload), 0);
  if coalesce(NEW.total_amount,0) > 0 then
    v_wh := least(greatest(v_wh, 0), NEW.total_amount);
  else
    v_wh := 0;
  end if;
  v_net_due := round(coalesce(NEW.total_amount,0) - v_wh, 2);

  select array_agg(due_date order by installment), array_agg(amount order by installment),
         array_agg(method order by installment), count(*), coalesce(sum(amount),0)
    into v_dues, v_amts, v_mets, n, sum_rate
  from public.fn_parse_invoice_payments(v_realxml) where due_date is not null and amount is not null;
  v_tp := public.fn_parse_invoice_condizioni(v_realxml);
  if coalesce(n,0) = 0 then
    select array_agg(due_date order by installment), array_agg(amount order by installment),
           array_agg(method order by installment), count(*), coalesce(sum(amount),0)
      into v_dues, v_amts, v_mets, n, sum_rate
    from public.fn_parse_invoice_payments_json(NEW.payload) where due_date is not null and amount is not null;
  end if;
  if v_tp is null then v_tp := public.fn_parse_invoice_condizioni_json(NEW.payload); end if;
  if v_mets is null or v_mets[1] is null then
    select array_agg(method order by installment) into v_mets
    from public.fn_parse_invoice_payments(v_realxml) where method is not null;
    if v_mets is null then
      select array_agg(method order by installment) into v_mets
      from public.fn_parse_invoice_payments_json(NEW.payload) where method is not null;
    end if;
  end if;
  v_due_fallback := NEW.invoice_date;

  select id into v_supplier_id from public.suppliers
  where company_id = v_company_id and (partita_iva = NEW.sender_vat or vat_number = NEW.sender_vat) limit 1;
  if v_supplier_id is null then
    insert into public.suppliers (id, company_id, name, ragione_sociale, vat_number, partita_iva, nazione, source, is_active, payment_terms, payment_method)
    values (gen_random_uuid(), v_company_id, v_name, v_name, NEW.sender_vat, NEW.sender_vat, coalesce(NEW.sender_country,'IT'), 'acube_sdi', true, 30, 'bonifico_ordinario')
    returning id into v_supplier_id;
  end if;
  select payment_base, prima_scadenza_gg, numero_rate, payment_bank_account_id, default_payment_method::text
    into v_pb, v_prima, v_nrate, v_bank, v_smethod
  from public.suppliers where id = v_supplier_id;

  v_method := public.fn_sdi_mp_to_payment_method(v_mets[1], v_smethod);

  insert into public.electronic_invoices (id, company_id, invoice_number, invoice_date, supplier_name, supplier_vat,
    net_amount, vat_amount, gross_amount, withholding_amount, due_date, sdi_id, sdi_status, tipo_documento, source, xml_content, acube_uuid, codice_destinatario,
    payment_method, payment_terms, created_at)
  values (gen_random_uuid(), v_company_id, NEW.invoice_number, NEW.invoice_date, v_name, NEW.sender_vat,
    v_net, v_vat, NEW.total_amount, v_wh, coalesce(v_dues[1], v_due_fallback), NEW.sdi_file_id, public._acube_marking_to_sdi_status(NEW.marking), NEW.document_type, 'api_acube_sdi',
    v_xml, NEW.acube_uuid, NEW.recipient_code,
    v_mets[1], v_tp, now())
  on conflict (acube_uuid) do nothing returning id into v_electronic_invoice_id;
  if v_electronic_invoice_id is null then
    select id into v_electronic_invoice_id from public.electronic_invoices where acube_uuid = NEW.acube_uuid;
  end if;

  if upper(coalesce(NEW.document_type, '')) in ('TD16','TD17','TD18','TD19') then
    return NEW;
  end if;

  -- Note di credito: invariate, restano sul totale documento.
  v_is_nc := upper(coalesce(NEW.document_type, '')) in ('TD04', 'TD08');
  if v_is_nc then
    insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
      gross_amount, status, payment_method, payment_method_code, electronic_invoice_id, acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, created_at)
    values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date,
      coalesce(v_dues[1], v_due_fallback), coalesce(v_dues[1], v_due_fallback),
      -abs(NEW.total_amount), 'nota_credito'::payable_status, 'bonifico_ordinario'::payment_method, coalesce(v_mets[1], null),
      v_electronic_invoice_id, NEW.acube_uuid, v_name, NEW.sender_vat, 1, 1, now())
    on conflict do nothing;
    return NEW;
  end if;

  v_note := 'Termini letti dalla fattura'
            || case when v_mets[1] is not null then ' (' || v_mets[1] || coalesce(' ' || public.fn_sdi_mp_label(v_mets[1]), '') || ')' else '' end
            || case when v_tp is not null then ' ' || v_tp else '' end
            || case when v_wh > 0 then ' | ritenuta d''acconto ' || trim(to_char(v_wh, 'FM999999990.00')) || ' dedotta dal totale ' || trim(to_char(coalesce(NEW.total_amount,0), 'FM999999990.00')) else '' end;
  tol := greatest(0.05, coalesce(NEW.total_amount,0)*0.001);

  -- 1) N >= 2 rate lette dalla fattura, che quadrano col netto da pagare
  --    (o col lordo, se l'emittente espone le rate al lordo della ritenuta)
  if coalesce(NEW.total_amount,0) > 0 and n is not null and n >= 2
     and ( abs(sum_rate - v_net_due) <= tol
           or (v_wh > 0 and abs(sum_rate - NEW.total_amount) <= tol) ) then
    if v_wh > 0 and abs(sum_rate - v_net_due) > tol then
      for i in 1..n loop v_amts[i] := round(v_amts[i] * v_net_due / NEW.total_amount, 2); end loop;
    end if;
    v_amts[n] := round(v_net_due - (select coalesce(sum(a),0) from unnest(v_amts[1:n-1]) a), 2);
    for i in 1..n loop
      v_whs[i] := case when v_wh > 0 and v_net_due <> 0 then round(v_wh * v_amts[i] / v_net_due, 2) else 0 end;
    end loop;
    if v_wh > 0 then
      v_whs[n] := round(v_wh - (select coalesce(sum(w),0) from unnest(v_whs[1:n-1]) w), 2);
    end if;
    for i in 1..n loop
      insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
        gross_amount, withholding_amount, status, payment_method, payment_method_code, payment_method_label, payment_bank_account_id, electronic_invoice_id,
        acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, notes, created_at)
      values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[i], v_dues[i],
        v_amts[i], coalesce(v_whs[i],0), 'da_pagare'::payable_status,
        public.fn_sdi_mp_to_payment_method(coalesce(v_mets[i], v_mets[1]), v_smethod), coalesce(v_mets[i], v_mets[1]),
        public.fn_sdi_mp_label(coalesce(v_mets[i], v_mets[1])), v_bank, v_electronic_invoice_id,
        case when i = 1 then NEW.acube_uuid else null end, v_name, NEW.sender_vat, i, n, v_note, now())
      on conflict do nothing;
    end loop;

  -- 2) almeno una scadenza in fattura: rata unica alla data del fornitore
  elsif coalesce(n,0) >= 1 then
    insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
      gross_amount, withholding_amount, status, payment_method, payment_method_code, payment_method_label, payment_bank_account_id, electronic_invoice_id,
      acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, notes, created_at)
    values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[1], v_dues[1],
      v_net_due, v_wh, 'da_pagare'::payable_status,
      v_method, v_mets[1], public.fn_sdi_mp_label(v_mets[1]), v_bank, v_electronic_invoice_id,
      NEW.acube_uuid, v_name, NEW.sender_vat, 1, 1, v_note, now())
    on conflict do nothing;

  -- 3) nessun termine in fattura: piano fornitore
  elsif NEW.invoice_date >= DATE '2026-07-31'
        and v_pb is not null and v_nrate is not null and coalesce(NEW.total_amount,0) <> 0 then
    v_wh_acc := 0;
    for rec in
      select rata, due_date, importo
      from public.fn_supplier_installment_schedule(NEW.invoice_date, v_pb, v_prima, v_nrate, v_net_due)
    loop
      if v_wh <= 0 then
        v_row_wh := 0;
      elsif rec.rata = v_nrate then
        v_row_wh := round(v_wh - v_wh_acc, 2);
      else
        v_row_wh := case when v_net_due <> 0 then round(v_wh * rec.importo / v_net_due, 2) else 0 end;
        v_wh_acc := v_wh_acc + v_row_wh;
      end if;
      insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
        gross_amount, withholding_amount, status, payment_method, payment_method_code, payment_method_label, payment_bank_account_id, electronic_invoice_id,
        acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, notes, created_at)
      values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, rec.due_date, rec.due_date,
        rec.importo, v_row_wh, 'da_pagare'::payable_status,
        v_method, v_mets[1], public.fn_sdi_mp_label(v_mets[1]), v_bank, v_electronic_invoice_id,
        case when rec.rata = 1 then NEW.acube_uuid else null end, v_name, NEW.sender_vat, rec.rata, v_nrate,
        'Auto-generata da piano fornitore (fattura senza termini di pagamento)'
          || case when v_wh > 0 then ' | ritenuta d''acconto ' || trim(to_char(v_wh, 'FM999999990.00')) || ' dedotta dal totale' else '' end, now())
      on conflict do nothing;
    end loop;

  -- 4) fallback: rata unica alla data fattura
  else
    insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
      gross_amount, withholding_amount, status, payment_method, payment_method_code, payment_method_label, payment_bank_account_id, electronic_invoice_id,
      acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, created_at)
    values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date,
      v_due_fallback, v_due_fallback,
      v_net_due, v_wh, 'da_pagare'::payable_status, v_method, v_mets[1], public.fn_sdi_mp_label(v_mets[1]), v_bank,
      v_electronic_invoice_id, NEW.acube_uuid, v_name, NEW.sender_vat, 1, 1, now())
    on conflict do nothing;
  end if;
  return NEW;
end; $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B) aggancio notula manuale <-> fattura SDI: match anche al lordo + ritenuta
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_prevent_duplicate_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  existing_id uuid; existing_status text;
  v_notula_merge boolean := false; v_cands uuid[]; v_norm text;
BEGIN
  IF NEW.is_forecast IS TRUE OR NEW.recurring_cost_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.electronic_invoice_id IS NOT NULL THEN
    SELECT id, status::text INTO existing_id, existing_status FROM payables
    WHERE company_id = NEW.company_id AND electronic_invoice_id = NEW.electronic_invoice_id
      AND COALESCE(installment_number,1) = COALESCE(NEW.installment_number,1)
    ORDER BY (status='annullato')::int ASC,
             (COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale'))::int DESC,
             created_at ASC LIMIT 1;
    IF existing_id IS NULL AND COALESCE(NEW.installment_number,1)=1 AND COALESCE(NEW.installment_total,1)=1 THEN
      v_norm := public.fn_normalize_invoice_number(NEW.invoice_number);
      IF v_norm <> '' THEN
        SELECT array_agg(id) INTO v_cands FROM payables
        WHERE company_id = NEW.company_id AND electronic_invoice_id IS NULL AND acube_uuid IS NULL
          AND status IS DISTINCT FROM 'annullato' AND COALESCE(installment_number,1)=1
          AND public.fn_normalize_invoice_number(invoice_number) = v_norm
          AND ((NEW.supplier_vat IS NOT NULL AND NEW.supplier_vat<>'' AND supplier_vat=NEW.supplier_vat)
               OR (NEW.supplier_id IS NOT NULL AND supplier_id=NEW.supplier_id)
               OR (NEW.supplier_name IS NOT NULL AND supplier_name=NEW.supplier_name));
        IF v_cands IS NOT NULL AND array_length(v_cands,1)=1 THEN existing_id:=v_cands[1]; v_notula_merge:=true; END IF;
      END IF;
      IF existing_id IS NULL AND NEW.gross_amount IS NOT NULL AND NEW.gross_amount<>0 THEN
        -- La notula manuale puo' essere stata registrata al netto della ritenuta
        -- (come la paga il fornitore) oppure al totale documento: accettiamo
        -- entrambe le letture. Resta la regola: si fonde solo se e' UNA sola.
        SELECT array_agg(id) INTO v_cands FROM payables
        WHERE company_id = NEW.company_id AND electronic_invoice_id IS NULL AND acube_uuid IS NULL
          AND status IS DISTINCT FROM 'annullato' AND COALESCE(installment_number,1)=1
          AND ( abs(coalesce(gross_amount,0) - NEW.gross_amount) < 0.01
                OR (COALESCE(NEW.withholding_amount,0) > 0
                    AND abs(coalesce(gross_amount,0) - (NEW.gross_amount + NEW.withholding_amount)) < 0.01) )
          AND NEW.invoice_date IS NOT NULL AND invoice_date IS NOT NULL
          AND invoice_date BETWEEN (NEW.invoice_date - 200) AND (NEW.invoice_date + 45)
          AND ((NEW.supplier_vat IS NOT NULL AND NEW.supplier_vat<>'' AND supplier_vat=NEW.supplier_vat)
               OR (NEW.supplier_id IS NOT NULL AND supplier_id=NEW.supplier_id)
               OR (NEW.supplier_name IS NOT NULL AND supplier_name=NEW.supplier_name));
        IF v_cands IS NOT NULL AND array_length(v_cands,1)=1 THEN
          existing_id:=v_cands[1]; v_notula_merge:=true;
          SELECT status::text INTO existing_status FROM payables WHERE id=existing_id;
        END IF;
      END IF;
    END IF;
  ELSIF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN
    SELECT id, status::text INTO existing_id, existing_status FROM payables
    WHERE company_id = NEW.company_id AND electronic_invoice_id IS NULL
      AND invoice_number = NEW.invoice_number
      AND COALESCE(installment_number,1) = COALESCE(NEW.installment_number,1)
      AND ((supplier_id IS NOT NULL AND supplier_id=NEW.supplier_id)
           OR (supplier_vat IS NOT NULL AND supplier_vat<>'' AND supplier_vat=NEW.supplier_vat)
           OR (supplier_name IS NOT NULL AND supplier_name<>'' AND supplier_name=NEW.supplier_name))
    ORDER BY (status='annullato')::int ASC,
             (COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale'))::int DESC,
             created_at ASC LIMIT 1;
  ELSE RETURN NEW; END IF;
  IF existing_id IS NULL THEN RETURN NEW; END IF;
  IF v_notula_merge THEN
    UPDATE payables SET
      invoice_number=NEW.invoice_number, invoice_date=NEW.invoice_date,
      electronic_invoice_id=NEW.electronic_invoice_id, acube_uuid=COALESCE(acube_uuid,NEW.acube_uuid),
      net_amount=COALESCE(NEW.net_amount,net_amount), vat_amount=COALESCE(NEW.vat_amount,vat_amount),
      gross_amount=COALESCE(NEW.gross_amount,gross_amount),
      withholding_amount=COALESCE(NEW.withholding_amount,withholding_amount),
      due_date=CASE WHEN status IN ('pagato','parziale') THEN due_date ELSE COALESCE(NEW.due_date,due_date) END,
      original_due_date=COALESCE(original_due_date,NEW.original_due_date,NEW.due_date),
      payment_method=COALESCE(payment_method,NEW.payment_method),
      payment_method_code=COALESCE(payment_method_code,NEW.payment_method_code),
      supplier_id=COALESCE(supplier_id,NEW.supplier_id), supplier_name=COALESCE(NEW.supplier_name,supplier_name),
      supplier_vat=COALESCE(NEW.supplier_vat,supplier_vat), cost_category_id=COALESCE(cost_category_id,NEW.cost_category_id),
      notes=COALESCE(NULLIF(notes,''),'')||CASE WHEN COALESCE(notes,'')<>'' THEN ' ' ELSE '' END||'[Notula agganciata alla fattura SDI '||COALESCE(NEW.invoice_number,'')||']',
      updated_at=NOW()
    WHERE id=existing_id;
    RETURN NULL;
  END IF;
  IF existing_status IS DISTINCT FROM 'annullato' THEN
    UPDATE payables SET
      supplier_id=COALESCE(NEW.supplier_id,supplier_id), supplier_name=COALESCE(NEW.supplier_name,supplier_name),
      supplier_vat=COALESCE(NEW.supplier_vat,supplier_vat), gross_amount=COALESCE(NEW.gross_amount,gross_amount),
      withholding_amount=COALESCE(NEW.withholding_amount,withholding_amount),
      net_amount=COALESCE(NEW.net_amount,net_amount), vat_amount=COALESCE(NEW.vat_amount,vat_amount),
      due_date=COALESCE(NEW.due_date,due_date), original_due_date=COALESCE(original_due_date,NEW.original_due_date,NEW.due_date),
      payment_method=COALESCE(NEW.payment_method,payment_method), payment_method_code=COALESCE(NEW.payment_method_code,payment_method_code),
      payment_method_label=COALESCE(NEW.payment_method_label,payment_method_label), iban=COALESCE(NEW.iban,iban),
      installment_total=COALESCE(NEW.installment_total,installment_total),
      electronic_invoice_id=COALESCE(electronic_invoice_id,NEW.electronic_invoice_id), acube_uuid=COALESCE(acube_uuid,NEW.acube_uuid),
      cost_category_id=COALESCE(cost_category_id,NEW.cost_category_id), updated_at=NOW()
    WHERE id=existing_id;
  END IF;
  RETURN NULL;
END; $function$;

COMMIT;

-- =============================================================================
-- VERIFICA (da eseguire dopo l'applicazione su ogni tenant)
--
-- 1) le due funzioni conoscono la ritenuta
-- select proname,
--        pg_get_functiondef(oid) ilike '%fn_invoice_withholding%' as legge_ritenuta,
--        pg_get_functiondef(oid) ilike '%withholding_amount%'     as scrive_ritenuta
--   from pg_proc where proname in ('sync_acube_sdi_passive_to_payable','fn_prevent_duplicate_payable');
--
-- 2) nessuna scadenza aperta resta gonfiata della ritenuta
-- select e.invoice_number, e.supplier_name, e.gross_amount, p.gross_amount, p.status
--   from electronic_invoices e join payables p on p.electronic_invoice_id = e.id
--  where public.fn_invoice_withholding(e.xml_content,
--          case when left(ltrim(e.xml_content),1)='{' then e.xml_content::jsonb else null end) > 0
--    and coalesce(p.withholding_amount,0) = 0;
-- =============================================================================
