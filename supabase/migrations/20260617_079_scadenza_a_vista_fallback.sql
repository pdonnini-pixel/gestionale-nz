-- 079 — scadenza "a vista": il fallback è la DATA DI EMISSIONE, mai +30 giorni
--
-- Regola (Patrizio 17/06/2026): la scadenza di una fattura passiva è
--   1) la DataScadenzaPagamento del documento (XML/JSON), se presente (con split N rate);
--   2) altrimenti la fattura è "a vista" → scadenza = invoice_date.
-- Il fallback "invoice_date + 30 giorni" (o +termini fornitore) NON deve più
-- esistere. Niente stime: o data del documento, o data di emissione.
--
-- Questo file (forward, 3 tenant):
--  - fn_parse_invoice_payments_json: hardening (guardie jsonb_typeof — alcuni
--    payload hanno fattura_elettronica_body scalare → "cannot extract elements
--    from a scalar").
--  - sync_acube_sdi_passive_to_payable (path A-Cube) e fn_invoice_to_payable
--    (path upload): fallback scadenza = invoice_date.
-- Il backfill delle payables già a +30 senza scadenza nel documento è uno step
-- separato con backup (NO DATA LOSS), solo su NZ.

-- ─── Helper JSON rate: robusto ai payload non conformi ───────────────────────
create or replace function public.fn_parse_invoice_payments_json(p_payload jsonb)
returns table(installment int, due_date date, amount numeric, method text)
language plpgsql immutable as $$
declare i int := 0; v_bodies jsonb; v_body jsonb; v_dps jsonb; v_dp jsonb; v_dets jsonb; v_det jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then return; end if;
  v_bodies := p_payload->'fattura_elettronica_body';
  if v_bodies is null or jsonb_typeof(v_bodies) <> 'array' then return; end if;
  for v_body in select * from jsonb_array_elements(v_bodies) loop
    if jsonb_typeof(v_body) <> 'object' then continue; end if;
    v_dps := v_body->'dati_pagamento';
    if v_dps is null or jsonb_typeof(v_dps) <> 'array' then continue; end if;
    for v_dp in select * from jsonb_array_elements(v_dps) loop
      if jsonb_typeof(v_dp) <> 'object' then continue; end if;
      v_dets := v_dp->'dettaglio_pagamento';
      if v_dets is null or jsonb_typeof(v_dets) <> 'array' then continue; end if;
      for v_det in select * from jsonb_array_elements(v_dets) loop
        if jsonb_typeof(v_det) <> 'object' then continue; end if;
        i := i + 1; installment := i;
        begin due_date := nullif(trim(v_det->>'data_scadenza_pagamento'),'')::date; exception when others then due_date := null; end;
        begin amount := nullif(trim(v_det->>'importo_pagamento'),'')::numeric; exception when others then amount := null; end;
        method := nullif(trim(v_det->>'modalita_pagamento'),'');
        return next;
      end loop;
    end loop;
  end loop;
  return;
end; $$;

-- ─── Path A-Cube: fallback scadenza = invoice_date ───────────────────────────
CREATE OR REPLACE FUNCTION public.sync_acube_sdi_passive_to_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_company_id uuid; v_supplier_id uuid; v_electronic_invoice_id uuid;
  v_name text;
  n int; sum_rate numeric; tol numeric; i int; v_dues date[]; v_amts numeric[]; v_mets text[];
  v_net numeric; v_vat numeric; v_realxml text; v_xml text; v_due_fallback date;
begin
  if NEW.direction <> 'passive' then return NEW; end if;
  select id into v_company_id from public.companies limit 1;
  if v_company_id is null then return NEW; end if;

  v_realxml := ltrim(NEW.xml_content, chr(65279) || E' \t\r\n');
  if v_realxml is null or left(v_realxml,1) <> '<' then v_realxml := null; end if;

  -- Nome cedente: dato A-Cube → XML → payload JSON
  v_name := NEW.sender_name;
  if v_name is null or v_name ~ '^[0-9]+$' or v_name = NEW.sender_vat then
    v_name := public._acube_extract_cedente_name(v_realxml, NULL);
  end if;
  if v_name is null or v_name ~ '^[0-9]+$' or v_name = NEW.sender_vat then
    v_name := public._acube_cedente_name_json(NEW.payload, NEW.sender_vat);
  end if;

  -- Imponibile/IVA dal payload
  select coalesce(sum((r->>'imponibile_importo')::numeric), 0),
         coalesce(sum((r->>'imposta')::numeric), 0)
    into v_net, v_vat
  from jsonb_array_elements(coalesce(NEW.payload->'fattura_elettronica_body', '[]'::jsonb)) body
  cross join lateral jsonb_array_elements(coalesce(body #> '{dati_beni_servizi,dati_riepilogo}', '[]'::jsonb)) r;
  if coalesce(v_net,0) = 0 and coalesce(v_vat,0) = 0 and coalesce(NEW.total_amount,0) <> 0 then
    v_net := NEW.total_amount; v_vat := 0;
  end if;

  v_xml := coalesce(v_realxml, NEW.payload::text);

  -- Scadenze dal documento: XML reale, poi fallback payload JSON
  select array_agg(due_date order by installment), array_agg(amount order by installment),
         array_agg(method order by installment), count(*), coalesce(sum(amount),0)
    into v_dues, v_amts, v_mets, n, sum_rate
  from public.fn_parse_invoice_payments(v_realxml)
  where due_date is not null and amount is not null;
  if coalesce(n,0) = 0 then
    select array_agg(due_date order by installment), array_agg(amount order by installment),
           array_agg(method order by installment), count(*), coalesce(sum(amount),0)
      into v_dues, v_amts, v_mets, n, sum_rate
    from public.fn_parse_invoice_payments_json(NEW.payload)
    where due_date is not null and amount is not null;
  end if;

  -- FALLBACK "A VISTA": nessuna scadenza nel documento → data di emissione
  v_due_fallback := NEW.invoice_date;

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
  on conflict (acube_uuid) do nothing
  returning id into v_electronic_invoice_id;
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
    on conflict (acube_uuid) do nothing;
    for i in 2..n loop
      insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
        gross_amount, status, payment_method, payment_method_code, electronic_invoice_id, supplier_name, supplier_vat, installment_number, installment_total, created_at)
      values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[i], v_dues[i],
        v_amts[i], 'da_pagare'::payable_status, 'bonifico_ordinario'::payment_method, coalesce(v_mets[i], null), v_electronic_invoice_id, v_name, NEW.sender_vat, i, n, now())
      on conflict do nothing;
    end loop;
  else
    insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
      gross_amount, status, payment_method, payment_method_code, electronic_invoice_id, acube_uuid, supplier_name, supplier_vat, created_at)
    values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date,
      coalesce(v_dues[1], v_due_fallback), coalesce(v_dues[1], v_due_fallback),
      NEW.total_amount, 'da_pagare'::payable_status, 'bonifico_ordinario'::payment_method, coalesce(v_mets[1], null), v_electronic_invoice_id, NEW.acube_uuid, v_name, NEW.sender_vat, now())
    on conflict (acube_uuid) do nothing;
  end if;

  return NEW;
end; $function$;

-- ─── Path upload (electronic_invoices non-A-Cube): fallback = invoice_date ────
CREATE OR REPLACE FUNCTION public.fn_invoice_to_payable()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_supplier_id uuid; v_due date; n int; sum_rate numeric; tol numeric; i int; v_dues date[]; v_amts numeric[]; v_mets text[];
begin
  if NEW.acube_uuid is not null then return NEW; end if;
  select id into v_supplier_id from suppliers where company_id = NEW.company_id
    and ((NEW.supplier_vat is not null and vat_number = NEW.supplier_vat) or (NEW.supplier_name is not null and name ilike NEW.supplier_name)) limit 1;
  select array_agg(due_date order by installment), array_agg(amount order by installment), array_agg(method order by installment), count(*), coalesce(sum(amount),0)
    into v_dues, v_amts, v_mets, n, sum_rate from public.fn_parse_invoice_payments(NEW.xml_content) where due_date is not null and amount is not null;
  if coalesce(NEW.gross_amount,0) <= 0 or n is null or n = 0 then
    -- A VISTA: niente scadenza nel documento → data di emissione (mai +termini)
    v_due := coalesce(NEW.due_date, NEW.invoice_date);
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, net_amount, vat_amount, gross_amount, amount_remaining, electronic_invoice_id, import_batch_id, payment_method_code, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_due, v_due, NEW.net_amount, NEW.vat_amount, NEW.gross_amount, NEW.gross_amount, NEW.id, NEW.import_batch_id, NEW.payment_method, 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
    return NEW;
  end if;
  tol := greatest(0.05, NEW.gross_amount*0.001);
  if abs(sum_rate - NEW.gross_amount) > tol then
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, net_amount, vat_amount, gross_amount, amount_remaining, electronic_invoice_id, import_batch_id, payment_method_code, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[1], v_dues[1], NEW.net_amount, NEW.vat_amount, NEW.gross_amount, NEW.gross_amount, NEW.id, NEW.import_batch_id, coalesce(v_mets[1], NEW.payment_method), 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
    return NEW;
  end if;
  if n = 1 then
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, net_amount, vat_amount, gross_amount, amount_remaining, electronic_invoice_id, import_batch_id, payment_method_code, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[1], v_dues[1], NEW.net_amount, NEW.vat_amount, NEW.gross_amount, NEW.gross_amount, NEW.id, NEW.import_batch_id, coalesce(v_mets[1], NEW.payment_method), 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
    return NEW;
  end if;
  v_amts[n] := round(NEW.gross_amount - (select coalesce(sum(a),0) from unnest(v_amts[1:n-1]) a), 2);
  for i in 1..n loop
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, gross_amount, amount_remaining, electronic_invoice_id, import_batch_id, installment_number, installment_total, payment_method_code, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[i], v_dues[i], v_amts[i], v_amts[i], NEW.id, NEW.import_batch_id, i, n, coalesce(v_mets[i], NEW.payment_method), 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
  end loop;
  return NEW;
end; $$;
