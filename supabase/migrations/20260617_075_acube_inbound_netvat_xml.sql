-- 075 — fix dati scarico A-Cube fatture passive (regressione 073/074)
--
-- Problema: acube_sdi_sync_inbound_production inseriva acube_sdi_invoices senza
-- xml_content (solo payload JSON), e il trigger sync_acube_sdi_passive_to_payable
-- scriveva electronic_invoices con xml_content = payload JSON e SENZA net/vat.
-- Risultato: in pagina Imponibile/IVA vuoti e "Visualizza fattura formattata"
-- falliva (l'XML era in realtà il JSON A-Cube).
--
-- Fix forward (questo file, 3 tenant):
-- 1. La funzione di pull scarica il VERO FatturaPA XML da A-Cube
--    (GET {base}/invoices/{uuid} con Accept: application/xml) e lo salva in
--    acube_sdi_invoices.xml_content.
-- 2. Il trigger calcola net_amount = Σ imponibile_importo e vat_amount = Σ imposta
--    dal payload (dati_riepilogo), e usa il vero XML (COALESCE su payload solo
--    come fallback).
-- Il backfill dei dati già entrati è uno step separato con backup (NO DATA LOSS).

-- ─── 1. Trigger: net/vat dal payload + xml reale ─────────────────────────
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
  v_net numeric; v_vat numeric; v_xml text;
begin
  if NEW.direction <> 'passive' then return NEW; end if;
  select id into v_company_id from public.companies limit 1;
  if v_company_id is null then return NEW; end if;

  v_name := NEW.sender_name;
  if v_name is null or v_name ~ '^[0-9]+$' or v_name = NEW.sender_vat then
    v_name := public._acube_extract_cedente_name(coalesce(NEW.xml_content, NEW.payload::text), NEW.sender_vat);
  end if;

  -- Imponibile/IVA dal payload FatturaPA (somma su tutti i corpi e i riepiloghi)
  select coalesce(sum((r->>'imponibile_importo')::numeric), 0),
         coalesce(sum((r->>'imposta')::numeric), 0)
    into v_net, v_vat
  from jsonb_array_elements(coalesce(NEW.payload->'fattura_elettronica_body', '[]'::jsonb)) body
  cross join lateral jsonb_array_elements(coalesce(body #> '{dati_beni_servizi,dati_riepilogo}', '[]'::jsonb)) r;
  -- fallback: payload assente/non parsabile → niente NULL in pagina
  if coalesce(v_net,0) = 0 and coalesce(v_vat,0) = 0 and coalesce(NEW.total_amount,0) <> 0 then
    v_net := NEW.total_amount; v_vat := 0;
  end if;

  -- XML reale se presente, altrimenti il payload come ripiego
  v_xml := case when NEW.xml_content is not null and left(ltrim(NEW.xml_content),1) = '<'
                then NEW.xml_content else NEW.payload::text end;

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

  -- Scadenze reali dall'XML FatturaPA (NEW.xml_content)
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

-- ─── 2. Funzione di pull: scarica il vero FatturaPA XML ──────────────────
-- (identica alla 074 + fetch XML per ogni nuova fattura prima dell'INSERT)
CREATE OR REPLACE FUNCTION public.acube_sdi_sync_inbound_production(
  p_stage text DEFAULT 'production',
  p_origine text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_origine public.sync_origin;
  v_role text;
  v_creds record;
  v_login_url text;
  v_base_url text;
  v_login http_response;
  v_jwt text;
  v_company_id uuid;
  v_company_vat text;
  v_rec_vat text;
  v_page int := 1;
  v_max_pages int := 60;
  v_resp http_response;
  v_xmlresp http_response;
  v_xml text;
  v_arr jsonb;
  v_len int;
  v_item jsonb;
  v_uuid uuid;
  v_payload jsonb;
  v_doc jsonb;
  v_inv_num text;
  v_inv_date date;
  v_total numeric;
  v_currency text;
  v_new_this_page int;
  v_inserted int := 0;
  v_found int := 0;
  v_min_date date;
  v_max_date date;
  v_status public.sync_status;
  v_errmsg text := NULL;
BEGIN
  SELECT id, vat_number INTO v_company_id, v_company_vat FROM public.companies LIMIT 1;

  IF p_origine IS NOT NULL THEN
    v_origine := p_origine::public.sync_origin;
  ELSIF auth.uid() IS NOT NULL THEN
    v_origine := 'manuale';
  ELSE
    v_origine := 'auto_cron';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    v_role := public.get_my_role()::text;
    IF v_role IS NULL OR v_role NOT IN ('super_advisor','contabile','cfo') THEN
      RAISE EXCEPTION 'Ruolo % non autorizzato alla sincronizzazione fatture', COALESCE(v_role,'(nessuno)');
    END IF;
  END IF;

  IF p_stage NOT IN ('production','sandbox') THEN
    RAISE EXCEPTION 'Stage non valido: %', p_stage;
  END IF;
  IF p_stage = 'production' THEN
    v_login_url := 'https://common.api.acubeapi.com/login';
    v_base_url  := 'https://api.acubeapi.com';
  ELSE
    v_login_url := 'https://common-sandbox.api.acubeapi.com/login';
    v_base_url  := 'https://api-sandbox.acubeapi.com';
  END IF;

  PERFORM set_config('statement_timeout','170000', true);
  PERFORM http_set_curlopt('CURLOPT_TIMEOUT','30');

  SELECT email, password INTO v_creds FROM public.get_acube_credentials(p_stage) LIMIT 1;
  SELECT * INTO v_login FROM http((
    'POST', v_login_url,
    ARRAY[http_header('Accept','application/json')],
    'application/json',
    json_build_object('email', v_creds.email, 'password', v_creds.password)::text
  )::http_request);
  v_jwt := (v_login.content::jsonb)->>'token';

  IF v_jwt IS NULL THEN
    v_errmsg := 'login_failed: ' || COALESCE(LEFT(v_login.content,200),'no body');
    INSERT INTO public.sync_runs(company_id, feed, origine, status, items_downloaded, error_message, duration_ms, run_at)
    VALUES (v_company_id, 'fatture_passive', v_origine, 'errore', 0, v_errmsg,
            (extract(epoch from clock_timestamp()-v_started)*1000)::int, now());
    RETURN jsonb_build_object('ok',false,'error',v_errmsg,'inserted',0);
  END IF;

  LOOP
    EXIT WHEN v_page > v_max_pages;
    SELECT * INTO v_resp FROM http((
      'GET', format('%s/invoices?direction=in&page=%s', v_base_url, v_page),
      ARRAY[http_header('Authorization','Bearer '||v_jwt), http_header('Accept','application/json')],
      NULL, NULL
    )::http_request);

    IF v_resp.status <> 200 THEN
      v_errmsg := concat_ws(' | ', v_errmsg, format('page %s HTTP %s: %s', v_page, v_resp.status, LEFT(v_resp.content,150)));
      EXIT;
    END IF;

    v_arr := v_resp.content::jsonb;
    IF jsonb_typeof(v_arr) <> 'array' THEN
      v_arr := COALESCE(v_arr->'hydra:member', v_arr->'member', v_arr->'data', '[]'::jsonb);
    END IF;
    v_len := jsonb_array_length(v_arr);
    EXIT WHEN v_len = 0;
    v_found := v_found + v_len;
    v_new_this_page := 0;

    FOR v_item IN SELECT * FROM jsonb_array_elements(v_arr) LOOP
      v_uuid := nullif(COALESCE(v_item->>'uuid', v_item->>'id'),'')::uuid;
      IF v_uuid IS NULL THEN CONTINUE; END IF;

      v_rec_vat := v_item->'recipient'->>'business_vat_number_code';
      IF v_company_vat IS NOT NULL AND v_rec_vat IS NOT NULL
         AND regexp_replace(v_rec_vat,'\D','','g') <> regexp_replace(v_company_vat,'\D','','g') THEN
        CONTINUE;
      END IF;

      IF EXISTS (SELECT 1 FROM public.acube_sdi_invoices WHERE acube_uuid = v_uuid) THEN
        CONTINUE;
      END IF;

      BEGIN
        v_payload := (v_item->>'payload')::jsonb;
      EXCEPTION WHEN OTHERS THEN v_payload := NULL; END;
      v_doc := v_payload #> '{fattura_elettronica_body,0,dati_generali,dati_generali_documento}';
      v_inv_num  := v_doc->>'numero';
      v_inv_date := nullif(v_doc->>'data','')::date;
      v_total    := nullif(v_doc->>'importo_totale_documento','')::numeric;
      v_currency := COALESCE(v_doc->>'divisa','EUR');

      -- vero FatturaPA XML: stesso endpoint dettaglio con Accept: application/xml
      v_xml := NULL;
      BEGIN
        SELECT * INTO v_xmlresp FROM http((
          'GET', format('%s/invoices/%s', v_base_url, v_uuid),
          ARRAY[http_header('Authorization','Bearer '||v_jwt), http_header('Accept','application/xml')],
          NULL, NULL
        )::http_request);
        IF v_xmlresp.status = 200 AND left(ltrim(v_xmlresp.content),1) = '<' THEN
          v_xml := v_xmlresp.content;
        END IF;
      EXCEPTION WHEN OTHERS THEN v_xml := NULL; END;

      INSERT INTO public.acube_sdi_invoices (
        acube_uuid, business_fiscal_id, direction, type, marking,
        sdi_file_id, sdi_file_name, transmission_format, document_type,
        invoice_number, invoice_date, currency, total_amount, to_pa,
        sender_vat, sender_country, sender_name, recipient_vat, recipient_name, recipient_code,
        payload, xml_content, acube_created_at
      ) VALUES (
        v_uuid,
        v_item->'recipient'->>'business_vat_number_code',
        'passive',
        nullif(v_item->>'type','')::smallint,
        COALESCE(v_item->>'marking','received'),
        v_item->>'sdi_file_id',
        v_item->>'sdi_file_name',
        v_item->>'transmission_format',
        COALESCE(v_item->>'document_type', v_doc->>'tipo_documento'),
        v_inv_num, v_inv_date, v_currency, v_total,
        COALESCE((v_item->>'to_pa')::boolean,false),
        v_item->'sender'->>'business_vat_number_code',
        COALESCE(v_item->'sender'->>'business_vat_number_country','IT'),
        v_item->'sender'->>'business_name',
        v_item->'recipient'->>'business_vat_number_code',
        v_item->'recipient'->>'business_name',
        v_item->'recipient'->>'recipient_code',
        v_payload, v_xml,
        nullif(v_item->>'created_at','')::timestamptz
      );

      v_inserted := v_inserted + 1;
      v_new_this_page := v_new_this_page + 1;
      IF v_inv_date IS NOT NULL THEN
        v_min_date := least(COALESCE(v_min_date, v_inv_date), v_inv_date);
        v_max_date := greatest(COALESCE(v_max_date, v_inv_date), v_inv_date);
      END IF;
    END LOOP;

    EXIT WHEN v_new_this_page = 0;
    EXIT WHEN v_len < 30;
    v_page := v_page + 1;
  END LOOP;

  v_status := CASE
    WHEN v_errmsg IS NOT NULL AND v_inserted > 0 THEN 'parziale'
    WHEN v_errmsg IS NOT NULL THEN 'errore'
    ELSE 'ok'
  END::public.sync_status;

  INSERT INTO public.sync_runs(company_id, feed, origine, period_from, period_to, status, items_downloaded, error_message, duration_ms, run_at)
  VALUES (v_company_id, 'fatture_passive', v_origine, v_min_date, v_max_date, v_status, v_inserted,
          CASE WHEN v_errmsg IS NOT NULL THEN LEFT(v_errmsg,4000) ELSE NULL END,
          (extract(epoch from clock_timestamp()-v_started)*1000)::int, now());

  RETURN jsonb_build_object('ok', v_errmsg IS NULL, 'inserted', v_inserted, 'found', v_found,
                            'pages', v_page, 'status', v_status, 'error', v_errmsg);
EXCEPTION WHEN OTHERS THEN
  IF v_company_id IS NOT NULL THEN
    INSERT INTO public.sync_runs(company_id, feed, origine, status, items_downloaded, error_message, duration_ms, run_at)
    VALUES (v_company_id, 'fatture_passive', COALESCE(v_origine,'auto_cron'), 'errore', v_inserted, LEFT(SQLERRM,4000),
            (extract(epoch from clock_timestamp()-v_started)*1000)::int, now());
  END IF;
  RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.acube_sdi_sync_inbound_production(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acube_sdi_sync_inbound_production(text,text) TO authenticated, service_role;
