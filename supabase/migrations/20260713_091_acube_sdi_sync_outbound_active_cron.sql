-- Migrazione 091 — Download automatico fatture ATTIVE (vendita) dal Cassetto A-Cube
--
-- CONTESTO
-- Il cron esistente acube_sdi_sync_inbound_production() scarica solo le
-- fatture PASSIVE (GET /invoices?direction=in). Le fatture ATTIVE oggi
-- entrano solo quando emesse a mano dal form (edge function
-- acube-sdi-send-invoice). Questa migration aggiunge il pull automatico
-- delle attive (GET /invoices?direction=out), speculare a quello passive.
--
-- Le attive scaricate vengono inserite in acube_sdi_invoices con
-- direction='active'; da lì il trigger sync_acube_sdi_active_to_einvoice
-- (vedi migration 090) le propaga in active_invoices, la tabella letta dal
-- tab "Attive". Il trigger passive (sync_acube_sdi_passive_to_payable) ignora
-- le righe non-passive, quindi NON genera payable per le vendite.
--
-- Funzione GEMELLA e ISOLATA: il flusso passive collaudato resta intatto.
-- Additiva. Nessuna perdita dati.
--
-- NOTA APPLICAZIONE: se il runner racchiude il file in un'unica transaction e
-- Postgres si lamenta dell'ALTER TYPE ADD VALUE, eseguire lo statement 1 da
-- solo (commit) e poi il resto. Con IF NOT EXISTS è comunque idempotente.

-- 1. Nuovo valore enum per loggare il feed attive in sync_runs.
ALTER TYPE public.sync_feed ADD VALUE IF NOT EXISTS 'fatture_attive';

-- 2. Funzione di sync outbound (attive), speculare all'inbound.
CREATE OR REPLACE FUNCTION public.acube_sdi_sync_outbound_production(
  p_stage text DEFAULT 'production',
  p_origine text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  v_snd_vat text;
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
    VALUES (v_company_id, 'fatture_attive', v_origine, 'errore', 0, v_errmsg,
            (extract(epoch from clock_timestamp()-v_started)*1000)::int, now());
    RETURN jsonb_build_object('ok',false,'error',v_errmsg,'inserted',0);
  END IF;

  LOOP
    EXIT WHEN v_page > v_max_pages;
    SELECT * INTO v_resp FROM http((
      'GET', format('%s/invoices?direction=out&page=%s', v_base_url, v_page),
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

      -- Guardia tenant: per le ATTIVE il mittente (cedente) è la nostra azienda.
      v_snd_vat := v_item->'sender'->>'business_vat_number_code';
      IF v_company_vat IS NOT NULL AND v_snd_vat IS NOT NULL
         AND regexp_replace(v_snd_vat,'\D','','g') <> regexp_replace(v_company_vat,'\D','','g') THEN
        CONTINUE;
      END IF;

      -- Idempotenza: già emesse dal form o già scaricate.
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

      v_xml := NULL;
      BEGIN
        SELECT * INTO v_xmlresp FROM http((
          'GET', format('%s/invoices/%s', v_base_url, v_uuid),
          ARRAY[http_header('Authorization','Bearer '||v_jwt), http_header('Accept','application/xml')],
          NULL, NULL
        )::http_request);
        IF v_xmlresp.status = 200 THEN
          v_xml := ltrim(v_xmlresp.content, chr(65279) || E' \t\r\n');
          IF left(v_xml,1) <> '<' THEN v_xml := NULL; END IF;
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
        v_item->'sender'->>'business_vat_number_code',
        'active',
        nullif(v_item->>'type','')::smallint,
        COALESCE(v_item->>'marking','sent'),
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
  VALUES (v_company_id, 'fatture_attive', v_origine, v_min_date, v_max_date, v_status, v_inserted,
          CASE WHEN v_errmsg IS NOT NULL THEN LEFT(v_errmsg,4000) ELSE NULL END,
          (extract(epoch from clock_timestamp()-v_started)*1000)::int, now());

  RETURN jsonb_build_object('ok', v_errmsg IS NULL, 'inserted', v_inserted, 'found', v_found,
                            'pages', v_page, 'status', v_status, 'error', v_errmsg);
EXCEPTION WHEN OTHERS THEN
  IF v_company_id IS NOT NULL THEN
    INSERT INTO public.sync_runs(company_id, feed, origine, status, items_downloaded, error_message, duration_ms, run_at)
    VALUES (v_company_id, 'fatture_attive', COALESCE(v_origine,'auto_cron'), 'errore', v_inserted, LEFT(SQLERRM,4000),
            (extract(epoch from clock_timestamp()-v_started)*1000)::int, now());
  END IF;
  RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.acube_sdi_sync_outbound_production(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acube_sdi_sync_outbound_production(text,text) TO authenticated, service_role;

-- 3. Cron fatture attive ogni 6h, sfasato 15' dal cron passive (che è '30 0,6,12,18').
SELECT cron.schedule(
  'acube-sdi-sync-outbound-every-6h',
  '45 0,6,12,18 * * *',
  $cron$ SELECT public.acube_sdi_sync_outbound_production('production','auto_cron'); $cron$
);
