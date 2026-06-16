-- 074 — hardening acube_sdi_sync_inbound_production
--
-- Due fix sul 073:
-- 1. GUARDIA TENANT: l'account A-Cube è condiviso fra i tenant in fase di
--    avvio (le credenziali acube_main_* possono puntare allo stesso account).
--    Senza filtro, l'inbound inserirebbe le fatture di un'azienda nel DB di
--    un'altra. Scartiamo ogni documento il cui destinatario (recipient VAT)
--    non coincide con la P.IVA dell'azienda del tenant. Su un tenant senza
--    fatture proprie in quell'account → inserted=0, status=ok (corretto).
-- 2. SICUREZZA: la funzione SECURITY DEFINER fa chiamate esterne + scrive →
--    REVOKE EXECUTE da anon (oltre che da PUBLIC). Mai eseguibile non loggati.

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

  PERFORM set_config('statement_timeout','110000', true);
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

      -- GUARDIA TENANT: scarta documenti destinati ad altra azienda
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

      INSERT INTO public.acube_sdi_invoices (
        acube_uuid, business_fiscal_id, direction, type, marking,
        sdi_file_id, sdi_file_name, transmission_format, document_type,
        invoice_number, invoice_date, currency, total_amount, to_pa,
        sender_vat, sender_country, sender_name, recipient_vat, recipient_name, recipient_code,
        payload, acube_created_at
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
        v_payload,
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
