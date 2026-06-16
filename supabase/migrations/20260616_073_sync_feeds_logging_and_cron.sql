-- 073 — logging sync_runs sui feed + cron fatture passive ogni 6h
--
-- 1. acube_ob_sync_all_production(): aggiunge una riga sync_runs(feed=banche)
--    a fine run (oggi non logga nulla).
-- 2. acube_sdi_sync_inbound_production(): NUOVA funzione SECURITY DEFINER che
--    replica il pattern OB (login A-Cube + fetch via extension http) per le
--    fatture passive REST. Idempotente (skip su acube_uuid già presente),
--    pagina la lista /invoices?direction=in (30/pagina, param page), popola
--    invoice_number/date/total dal payload FatturaPA così il trigger
--    sync_acube_sdi_passive_to_payable crea electronic_invoices con data reale.
--    Logga sync_runs(feed=fatture_passive). Usata da cron (auto) e da UI (manuale).
-- 3. Cron pg_cron ogni 6h, sfasato di 30' dal cron OB per non collidere sul
--    login A-Cube.

-- ─── 1. OB: logging banche ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.acube_ob_sync_all_production()
 RETURNS TABLE(fiscal_id text, accounts integer, transactions integer, error text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_creds RECORD;
  v_jwt TEXT;
  v_login_resp http_response;
  v_acc_resp http_response;
  v_tx_resp http_response;
  v_br RECORD;
  v_acc JSONB;
  v_company_id UUID;
  v_acc_count INT;
  v_tx_count INT;
  v_err TEXT;
  v_inserted INT;
  -- logging sync_runs
  v_started TIMESTAMPTZ := clock_timestamp();
  v_tot_tx INT := 0;
  v_err_agg TEXT := NULL;
BEGIN
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;

  SELECT email, password INTO v_creds FROM get_acube_credentials('production') LIMIT 1;
  SELECT * INTO v_login_resp FROM http(('POST',
    'https://common.api.acubeapi.com/login',
    ARRAY[http_header('Accept','application/json')],
    'application/json',
    json_build_object('email', v_creds.email, 'password', v_creds.password)::text
  )::http_request);
  v_jwt := (v_login_resp.content::jsonb)->>'token';
  IF v_jwt IS NULL THEN
    INSERT INTO public.sync_runs(company_id, feed, origine, status, items_downloaded, error_message, duration_ms, run_at)
    VALUES (v_company_id, 'banche', 'auto_cron', 'errore', 0,
            'login_failed: ' || COALESCE(LEFT(v_login_resp.content,200),'no body'),
            (extract(epoch from clock_timestamp()-v_started)*1000)::int, now());
    RETURN QUERY SELECT 'LOGIN'::text, 0, 0, 'login_failed: ' || COALESCE(LEFT(v_login_resp.content,200), 'no body');
    RETURN;
  END IF;

  FOR v_br IN
    SELECT abr.uuid AS br_uuid, abr.fiscal_id, abr.business_name
    FROM acube_business_registries abr
    WHERE abr.stage = 'production' AND abr.enabled = true
  LOOP
    v_acc_count := 0; v_tx_count := 0; v_err := NULL;

    BEGIN
      SELECT * INTO v_acc_resp FROM http((
        'GET',
        format('https://ob.api.acubeapi.com/business-registry/%s/accounts', v_br.fiscal_id),
        ARRAY[http_header('Authorization','Bearer '||v_jwt), http_header('Accept','application/json')],
        NULL, NULL
      )::http_request);

      IF v_acc_resp.status = 200 THEN
        FOR v_acc IN SELECT acc FROM jsonb_array_elements(v_acc_resp.content::jsonb) AS acc(acc)
          WHERE (acc->>'enabled')::boolean LOOP

          INSERT INTO acube_accounts (uuid, business_registry_uuid, account_id, account_number, iban, bban, swift,
            name, nature, provider_name, provider_country, currency_code, balance, enabled, connection_id, consent_expires_at, extra)
          VALUES (
            (v_acc->>'uuid')::uuid, v_br.br_uuid, v_acc->>'accountId', v_acc->>'accountNumber', v_acc->>'iban', v_acc->>'bban', v_acc->>'swift',
            COALESCE(v_acc->>'name', v_acc->>'iban'), v_acc->>'nature', v_acc->>'providerName', 'IT',
            v_acc->>'currencyCode', (v_acc->>'balance')::numeric, (v_acc->>'enabled')::boolean,
            v_acc->>'connectionId', (v_acc->>'consentExpiresAt')::timestamptz, v_acc
          )
          ON CONFLICT (uuid) DO UPDATE SET balance=EXCLUDED.balance, enabled=EXCLUDED.enabled, updated_at=now();

          UPDATE bank_accounts SET
            current_balance = (v_acc->>'balance')::numeric,
            balance_updated_at = now(),
            is_active = (v_acc->>'enabled')::boolean,
            updated_at = now()
          WHERE acube_account_uuid = (v_acc->>'uuid')::uuid;

          IF NOT FOUND THEN
            INSERT INTO bank_accounts (company_id, bank_name, iban, account_name, account_type, currency,
              is_active, is_manual, current_balance, balance_updated_at, acube_account_uuid)
            VALUES (v_company_id,
              COALESCE(v_acc->>'providerName', 'Banca'),
              v_acc->>'iban',
              COALESCE(v_acc->>'name', v_acc->>'iban'),
              'conto_corrente', v_acc->>'currencyCode',
              true, false,
              (v_acc->>'balance')::numeric, now(),
              (v_acc->>'uuid')::uuid);
          END IF;

          v_acc_count := v_acc_count + 1;

          SELECT * INTO v_tx_resp FROM http((
            'GET',
            format('https://ob.api.acubeapi.com/business-registry/%s/transactions?account=%s&itemsPerPage=100',
              v_br.fiscal_id, v_acc->>'uuid'),
            ARRAY[http_header('Authorization','Bearer '||v_jwt), http_header('Accept','application/json')],
            NULL, NULL
          )::http_request);

          IF v_tx_resp.status = 200 THEN
            INSERT INTO bank_transactions (
              company_id, bank_account_id, transaction_date, booking_date, value_date,
              amount, currency, description, status, source, acube_transaction_id, raw_data, is_reconciled,
              acube_dedup_hash
            )
            SELECT v_company_id, ba.id,
              (LEFT(x.t->>'madeOn',10))::date, (LEFT(x.t->>'madeOn',10))::date, (LEFT(x.t->>'madeOn',10))::date,
              (x.t->>'amount')::numeric, x.t->>'currencyCode', x.t->>'description',
              'booked', 'acube_ob', x.t->>'transactionId', x.t, false,
              public.bank_tx_canonical_hash_occ(
                ba.id, (LEFT(x.t->>'madeOn',10))::date, (x.t->>'amount')::numeric, x.t->>'description',
                (row_number() OVER (
                  PARTITION BY ba.id, LEFT(x.t->>'madeOn',10), x.t->>'amount', LEFT(COALESCE(x.t->>'description',''),40)
                  ORDER BY x.t->>'transactionId'))::int
              )
            FROM jsonb_array_elements(v_tx_resp.content::jsonb) AS x(t)
            JOIN bank_accounts ba ON ba.company_id = v_company_id
                                 AND ba.acube_account_uuid = (x.t->'account'->>'uuid')::uuid
            ON CONFLICT (acube_dedup_hash) WHERE acube_dedup_hash IS NOT NULL DO NOTHING;
            GET DIAGNOSTICS v_inserted = ROW_COUNT;
            v_tx_count := v_tx_count + v_inserted;
          END IF;
        END LOOP;
      ELSE
        v_err := format('accounts HTTP %s: %s', v_acc_resp.status, LEFT(v_acc_resp.content, 150));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;

    v_tot_tx := v_tot_tx + v_tx_count;
    IF v_err IS NOT NULL THEN
      v_err_agg := concat_ws(' | ', v_err_agg, v_br.fiscal_id || ': ' || v_err);
    END IF;

    RETURN QUERY SELECT v_br.fiscal_id, v_acc_count, v_tx_count, v_err;
  END LOOP;

  INSERT INTO public.sync_runs(company_id, feed, origine, status, items_downloaded, error_message, duration_ms, run_at)
  VALUES (v_company_id, 'banche', 'auto_cron',
          CASE WHEN v_err_agg IS NOT NULL THEN 'parziale' ELSE 'ok' END::public.sync_status,
          v_tot_tx, CASE WHEN v_err_agg IS NOT NULL THEN LEFT(v_err_agg,4000) ELSE NULL END,
          (extract(epoch from clock_timestamp()-v_started)*1000)::int, now());
END;
$function$;

-- ─── 2. Fatture passive REST (login + fetch via http, idempotente) ───────
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
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;

  IF p_origine IS NOT NULL THEN
    v_origine := p_origine::public.sync_origin;
  ELSIF auth.uid() IS NOT NULL THEN
    v_origine := 'manuale';
  ELSE
    v_origine := 'auto_cron';
  END IF;

  -- guardia ruolo solo per chiamate utente (PostgREST); il cron (postgres) passa
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

    EXIT WHEN v_new_this_page = 0;  -- pagina interamente già nota → stop
    EXIT WHEN v_len < 30;           -- ultima pagina
    v_page := v_page + 1;
  END LOOP;

  v_status := CASE
    WHEN v_errmsg IS NOT NULL AND v_inserted > 0 THEN 'parziale'
    WHEN v_errmsg IS NOT NULL THEN 'errore'
    ELSE 'ok'   -- 0 nuovi documenti = ok (non errore)
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

-- Sicurezza: la funzione fa chiamate esterne + scrive → mai eseguibile da anon.
REVOKE ALL ON FUNCTION public.acube_sdi_sync_inbound_production(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acube_sdi_sync_inbound_production(text,text) TO authenticated, service_role;

-- ─── 3. Cron fatture passive ogni 6h (sfasato 30' dal cron OB) ───────────
SELECT cron.schedule(
  'acube-sdi-sync-inbound-every-6h',
  '30 0,6,12,18 * * *',
  $cron$ SELECT public.acube_sdi_sync_inbound_production('production','auto_cron'); $cron$
);
