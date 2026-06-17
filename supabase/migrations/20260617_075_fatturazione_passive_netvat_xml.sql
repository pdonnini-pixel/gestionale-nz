-- ════════════════════════════════════════════════════════════════════
-- 075 — Fatturazione passive: net/vat + XML reale dallo scarico A-Cube
-- Applicata su 3 tenant (NZ / Made / Zago). Parità funzione/trigger/view.
--
-- Regressione corretta: le fatture passive scaricate via
-- acube_sdi_sync_inbound_production (cron 6h + bottone "Sincronizza SDI")
-- entravano con net_amount/vat_amount NULL e con electronic_invoices.xml_content
-- contenente il JSON A-Cube invece del vero FatturaPA XML.
--
--   1) _acube_net_vat_from_payload(jsonb): net = Σ imponibile_importo,
--      vat = Σ imposta dal payload (dati_riepilogo), robusto a array/oggetto,
--      più body (lotti) e spazi.
--   2) Trigger sync_acube_sdi_passive_to_payable: calcola net/vat e salva in
--      electronic_invoices.xml_content il vero XML (NEW.xml_content), non il payload.
--   3) acube_sdi_sync_inbound_production: scarica il FatturaPA XML reale da A-Cube
--      (GET /invoices/{uuid}, Accept: application/xml) e lo salva in
--      acube_sdi_invoices.xml_content così il trigger lo propaga.
--   4) v_electronic_invoices_list.has_xml = XML reale (inizia per '<').
--   5) v_electronic_invoices_kpi: aggregati passive per anno (totali reali,
--      indipendenti dal .limit della lista).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._acube_net_vat_from_payload(p_payload jsonb)
RETURNS TABLE(net numeric, vat numeric)
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $fn$
  WITH bodies AS (
    SELECT b FROM jsonb_array_elements(
      CASE jsonb_typeof(p_payload->'fattura_elettronica_body')
        WHEN 'array'  THEN p_payload->'fattura_elettronica_body'
        WHEN 'object' THEN jsonb_build_array(p_payload->'fattura_elettronica_body')
        ELSE '[]'::jsonb
      END
    ) AS b
  ),
  riep AS (
    SELECT r
    FROM bodies, LATERAL jsonb_array_elements(
      CASE jsonb_typeof(b #> '{dati_beni_servizi,dati_riepilogo}')
        WHEN 'array'  THEN b #> '{dati_beni_servizi,dati_riepilogo}'
        WHEN 'object' THEN jsonb_build_array(b #> '{dati_beni_servizi,dati_riepilogo}')
        ELSE '[]'::jsonb
      END
    ) AS r
  )
  SELECT
    round(sum(nullif(btrim(r->>'imponibile_importo'),'')::numeric), 2) AS net,
    round(sum(nullif(btrim(r->>'imposta'),'')::numeric), 2) AS vat
  FROM riep;
$fn$;

CREATE OR REPLACE FUNCTION public.sync_acube_sdi_passive_to_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_company_id uuid; v_supplier_id uuid; v_electronic_invoice_id uuid;
  v_default_terms integer := 30; v_due_date date; v_name text;
  v_net numeric; v_vat numeric; v_xml text;
  n int; sum_rate numeric; tol numeric; i int; v_dues date[]; v_amts numeric[]; v_mets text[];
begin
  if NEW.direction <> 'passive' then return NEW; end if;
  select id into v_company_id from public.companies limit 1;
  if v_company_id is null then return NEW; end if;

  v_name := NEW.sender_name;
  if v_name is null or v_name ~ '^[0-9]+$' or v_name = NEW.sender_vat then
    v_name := public._acube_extract_cedente_name(coalesce(NEW.xml_content, NEW.payload::text), NEW.sender_vat);
  end if;

  select net, vat into v_net, v_vat from public._acube_net_vat_from_payload(NEW.payload);
  v_xml := case when NEW.xml_content like '<%' then NEW.xml_content else NEW.payload::text end;

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

  select array_agg(due_date order by installment), array_agg(amount order by installment),
         array_agg(method order by installment), count(*), coalesce(sum(amount),0)
    into v_dues, v_amts, v_mets, n, sum_rate
  from public.fn_parse_invoice_payments(NEW.xml_content)
  where due_date is not null and amount is not null;

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

-- acube_sdi_sync_inbound_production: aggiunto fetch del FatturaPA XML reale
-- (GET /invoices/{uuid}, Accept: application/xml) salvato in
-- acube_sdi_invoices.xml_content. Corpo completo applicato via Management API;
-- la differenza rispetto alla 074 è: nuove var v_xml/v_xmlresp, il blocco fetch
-- XML nel loop, e la colonna xml_content aggiunta all'INSERT.
-- (Definizione completa applicata; vedi storia funzione nel DB.)

CREATE OR REPLACE VIEW public.v_electronic_invoices_list
WITH (security_invoker=true) AS
 SELECT id, company_id, outlet_id, invoice_number, invoice_date, supplier_name, supplier_vat,
    net_amount, vat_amount, gross_amount, cost_category_id, description, is_reconciled,
    monthly_cost_line_id, source, import_batch_id, notes, created_at, sdi_id, sdi_status,
    tipo_documento, xml_file_path, supplier_fiscal_code, codice_destinatario, payment_method,
    payment_terms, due_date, updated_at, retention_start, retention_end, retention_status,
    storage_path, acube_uuid, bank_transaction_id, cash_movement_id,
    (xml_content IS NOT NULL AND left(xml_content,1) = '<') AS has_xml
   FROM public.electronic_invoices e;

CREATE OR REPLACE VIEW public.v_electronic_invoices_kpi
WITH (security_invoker=true) AS
 SELECT company_id,
   (EXTRACT(YEAR FROM invoice_date))::int AS year,
   count(*)::int AS n_total,
   count(*) FILTER (WHERE tipo_documento = 'TD04')::int AS n_credit_notes,
   count(*) FILTER (WHERE sdi_id IS NOT NULL AND btrim(sdi_id) <> '')::int AS n_with_sdi,
   round(COALESCE(sum(gross_amount), 0), 2) AS sum_gross,
   round(COALESCE(sum(net_amount), 0), 2) AS sum_net,
   round(COALESCE(sum(vat_amount), 0), 2) AS sum_vat
 FROM public.electronic_invoices
 WHERE invoice_date IS NOT NULL
 GROUP BY company_id, (EXTRACT(YEAR FROM invoice_date))::int;
