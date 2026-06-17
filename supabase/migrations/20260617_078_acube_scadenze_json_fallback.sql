-- 078 — scadenze reali fatture passive A-Cube: derivazione robusta all'ingest
--
-- Problema: le scadenze (e lo split in rate) erano derivate solo da
-- electronic_invoices.xml_content / acube_sdi_invoices.xml_content. Le 91 fatture
-- del 17/06 erano state create quando l'XML era ancora il JSON A-Cube (illeggibile
-- come FatturaPA) → fn_parse_invoice_payments non trovava DettaglioPagamento →
-- fallback a invoice_date+30 e niente split. L'XML è stato sistemato dopo (075/076)
-- ma le scadenze non erano state ricalcolate.
--
-- Fix forward: la derivazione scadenze ora legge una fonte SEMPRE presente
-- all'ingest — il `payload` JSON FatturaPA (dati_pagamento/dettaglio_pagamento) —
-- con l'XML come ulteriore fonte. Stessa logica rate di PR #201/#203
-- (data reale + split N rate, installment_number/installment_total).
-- Anche il NOME del cedente (ditte individuali: nome+cognome, non denominazione)
-- ha un fallback dal payload JSON.
--
-- Il backfill delle 91 già create è uno step separato con backup (NO DATA LOSS),
-- riusando fn_backfill_payable_installments (mig 070) ora che l'XML è valido.

-- ─── Helper: rate dal payload JSON (parità con fn_parse_invoice_payments XML) ──
create or replace function public.fn_parse_invoice_payments_json(p_payload jsonb)
returns table(installment int, due_date date, amount numeric, method text)
language plpgsql immutable as $$
declare i int := 0; v_body jsonb; v_dp jsonb; v_det jsonb;
begin
  if p_payload is null then return; end if;
  for v_body in select * from jsonb_array_elements(coalesce(p_payload->'fattura_elettronica_body','[]'::jsonb)) loop
    for v_dp in select * from jsonb_array_elements(coalesce(v_body->'dati_pagamento','[]'::jsonb)) loop
      for v_det in select * from jsonb_array_elements(coalesce(v_dp->'dettaglio_pagamento','[]'::jsonb)) loop
        i := i + 1;
        installment := i;
        begin due_date := nullif(trim(v_det->>'data_scadenza_pagamento'),'')::date; exception when others then due_date := null; end;
        begin amount := nullif(trim(v_det->>'importo_pagamento'),'')::numeric; exception when others then amount := null; end;
        method := nullif(trim(v_det->>'modalita_pagamento'),'');
        return next;
      end loop;
    end loop;
  end loop;
  return;
end; $$;

-- ─── Helper: nome cedente dal payload JSON (denominazione → nome+cognome) ──────
create or replace function public._acube_cedente_name_json(p_payload jsonb, p_fallback text)
returns text language plpgsql immutable set search_path to 'public','pg_temp' as $$
declare v_an jsonb; v_denom text; v_nome text; v_cognome text;
begin
  if p_payload is null then return p_fallback; end if;
  v_an := p_payload #> '{fattura_elettronica_header,cedente_prestatore,dati_anagrafici,anagrafica}';
  if v_an is null then return p_fallback; end if;
  v_denom := nullif(btrim(coalesce(v_an->>'denominazione','')),'');
  if v_denom is null then
    v_nome := v_an->>'nome'; v_cognome := v_an->>'cognome';
    v_denom := nullif(btrim(coalesce(v_nome,'') || ' ' || coalesce(v_cognome,'')),'');
  end if;
  return coalesce(v_denom, p_fallback);
end; $$;

-- ─── Trigger ingest: scadenze + nome robusti (JSON fallback) ──────────────────
CREATE OR REPLACE FUNCTION public.sync_acube_sdi_passive_to_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_company_id uuid; v_supplier_id uuid; v_electronic_invoice_id uuid;
  v_default_terms integer := 30; v_due_date date; v_name text;
  n int; sum_rate numeric; tol numeric; i int; v_dues date[]; v_amts numeric[]; v_mets text[];
  v_net numeric; v_vat numeric; v_realxml text; v_xml text;
begin
  if NEW.direction <> 'passive' then return NEW; end if;
  select id into v_company_id from public.companies limit 1;
  if v_company_id is null then return NEW; end if;

  -- XML reale (BOM-stripped) se presente, altrimenti NULL
  v_realxml := ltrim(NEW.xml_content, chr(65279) || E' \t\r\n');
  if v_realxml is null or left(v_realxml,1) <> '<' then v_realxml := null; end if;

  -- Nome cedente: dato A-Cube → XML (denom/nome+cognome) → payload JSON
  v_name := NEW.sender_name;
  if v_name is null or v_name ~ '^[0-9]+$' or v_name = NEW.sender_vat then
    v_name := public._acube_extract_cedente_name(v_realxml, NULL);
  end if;
  if v_name is null or v_name ~ '^[0-9]+$' or v_name = NEW.sender_vat then
    v_name := public._acube_cedente_name_json(NEW.payload, NEW.sender_vat);
  end if;

  -- Imponibile/IVA dal payload FatturaPA
  select coalesce(sum((r->>'imponibile_importo')::numeric), 0),
         coalesce(sum((r->>'imposta')::numeric), 0)
    into v_net, v_vat
  from jsonb_array_elements(coalesce(NEW.payload->'fattura_elettronica_body', '[]'::jsonb)) body
  cross join lateral jsonb_array_elements(coalesce(body #> '{dati_beni_servizi,dati_riepilogo}', '[]'::jsonb)) r;
  if coalesce(v_net,0) = 0 and coalesce(v_vat,0) = 0 and coalesce(NEW.total_amount,0) <> 0 then
    v_net := NEW.total_amount; v_vat := 0;
  end if;

  v_xml := coalesce(v_realxml, NEW.payload::text);

  select id into v_supplier_id from public.suppliers
  where company_id = v_company_id and (partita_iva = NEW.sender_vat or vat_number = NEW.sender_vat) limit 1;
  if v_supplier_id is null then
    insert into public.suppliers (id, company_id, name, ragione_sociale, vat_number, partita_iva, nazione, source, is_active, payment_terms, payment_method)
    values (gen_random_uuid(), v_company_id, v_name, v_name, NEW.sender_vat, NEW.sender_vat, coalesce(NEW.sender_country,'IT'), 'acube_sdi', true, v_default_terms, 'bonifico_ordinario')
    returning id into v_supplier_id;
  else
    select coalesce(payment_terms, default_payment_terms, 30) into v_default_terms from public.suppliers where id = v_supplier_id;
  end if;

  v_due_date := NEW.invoice_date + (v_default_terms || ' days')::interval;

  insert into public.electronic_invoices (id, company_id, invoice_number, invoice_date, supplier_name, supplier_vat,
    net_amount, vat_amount, gross_amount, due_date, sdi_id, sdi_status, tipo_documento, source, xml_content, acube_uuid, codice_destinatario, created_at)
  values (gen_random_uuid(), v_company_id, NEW.invoice_number, NEW.invoice_date, v_name, NEW.sender_vat,
    v_net, v_vat, NEW.total_amount, v_due_date, NEW.sdi_file_id, public._acube_marking_to_sdi_status(NEW.marking), NEW.document_type, 'api_acube_sdi',
    v_xml, NEW.acube_uuid, NEW.recipient_code, now())
  on conflict (acube_uuid) do nothing
  returning id into v_electronic_invoice_id;
  if v_electronic_invoice_id is null then
    select id into v_electronic_invoice_id from public.electronic_invoices where acube_uuid = NEW.acube_uuid;
  end if;

  -- Scadenze: prima dall'XML reale; se assente/illeggibile, dal payload JSON
  -- (sempre presente all'ingest → niente dipendenza dal fetch XML).
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
      coalesce(v_dues[1], v_due_date), coalesce(v_dues[1], v_due_date),
      NEW.total_amount, 'da_pagare'::payable_status, 'bonifico_ordinario'::payment_method, coalesce(v_mets[1], null), v_electronic_invoice_id, NEW.acube_uuid, v_name, NEW.sender_vat, now())
    on conflict (acube_uuid) do nothing;
  end if;

  return NEW;
end; $function$;
