-- 097 — Cassetto Fiscale: sync automatico (RPC plpgsql + pg_cron + logging sync_runs)
--
-- PROBLEMA (diagnosi 2026-07-20):
--   Il canale Cassetto Fiscale A-Cube era configurato e `status='active'`
--   (appointee assegnato il 2026-06-01), ma NON era agganciato a nessun trigger:
--     • l'edge function `acube-cf-sync-invoices` non era richiamata da alcun cron;
--     • lo scheduler Netlify (`sdi-sync-scheduled`) è deprecato dal 2026-06-16;
--     • gli altri 3 feed (banche/fatture_passive/fatture_attive) usano invece RPC
--       plpgsql schedulate via pg_cron, il cassetto era rimasto orfano.
--   Risultato: `acube_cassetto_fiscale_config.last_sync_at` = NULL, zero righe in
--   `acube_cassetto_fiscale_pulls`, zero run `sync_runs(feed='cassetto_fiscale')`.
--   Le fatture che passano SOLO dal Cassetto AdE (e non dal canale SDI passive
--   di A-Cube) non entravano più: es. le fatture NEXI PAYMENTS da maggio 2026 in
--   poi (in banca gli addebiti SDD "A FAVORE NEXI" ci sono ogni mese, ma le
--   fatture corrispondenti si fermavano al 09/04/2026).
--
-- FIX:
--   Nuova RPC SECURITY DEFINER `acube_cf_sync_inbound_production` che replica il
--   pattern collaudato di `acube_sdi_sync_inbound_production` (login A-Cube via
--   extension http + fetch paginato + upsert idempotente su acube_sdi_invoices +
--   logging su sync_runs/sync_run_details), ma puntando all'endpoint Cassetto
--   Fiscale (host it.api.acubeapi.com/invoices). Iterata su TUTTE le config
--   cassetto attive del tenant (nessun valore hardcoded: fiscal_id dalla config).
--   Schedulata da pg_cron una volta al giorno (il feed cassetto è giornaliero).
--
--   Parsing DIFENSIVO: la risposta it.api/invoices espone i campi a livello
--   top-level (invoice_number, invoice_date, total_amount, sender/recipient
--   annidati) mentre il canale SDI espone un payload FatturaPA. La funzione fa
--   COALESCE su entrambe le forme per essere robusta.
--
-- SICUREZZA / NO DATA LOSS:
--   Solo INSERT idempotente (dedup su acube_uuid già esistente) + logging. Nessun
--   DELETE/DROP/UPDATE distruttivo. I trigger esistenti su acube_sdi_invoices
--   (trg_sync_acube_sdi_passive / _active) propagano poi in electronic_invoices /
--   payables come per il canale SDI. Se il tenant non ha config cassetto attiva,
--   la funzione esce senza scrivere nulla (no-op: Made/Zago finché non configurati).
--
-- ⚠️ PARITÀ TENANT: applicare A MANO su NZ + Made + Zago (3 project_id). Su Made e
--    Zago resterà inerte finché non avranno una config cassetto `active`.

-- ─────────────────────────────────────────────────────────────────────────
-- RPC: sync inbound Cassetto Fiscale
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.acube_cf_sync_inbound_production(
  p_stage   text DEFAULT 'production',
  p_origine text DEFAULT NULL,
  p_since   text DEFAULT NULL   -- 'YYYY-MM-DD'; se NULL usa ultimi 35 giorni
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_started    timestamptz := clock_timestamp();
  v_origine    public.sync_origin;
  v_role       text;
  v_creds      record;
  v_login_url  text;
  v_base_url   text;
  v_login      http_response;
  v_jwt        text;
  v_company_id uuid;
  v_since      text;
  v_cfg        record;
  v_cfg_count  int := 0;
  v_page       int;
  v_max_pages  int := 50;
  v_resp       http_response;
  v_arr        jsonb;
  v_len        int;
  v_item       jsonb;
  v_uuid       uuid;
  v_payload    jsonb;
  v_doc        jsonb;
  v_direction  text;
  v_inv_num    text;
  v_inv_date   date;
  v_total      numeric;
  v_currency   text;
  v_sender_name    text;
  v_sender_vat     text;
  v_recipient_vat  text;
  v_recipient_name text;
  v_new_this_page int;
  v_inserted   int := 0;
  v_found      int := 0;
  v_min_date   date;
  v_max_date   date;
  v_status     public.sync_status;
  v_errmsg     text := NULL;
  v_run_id     uuid;
  v_details    jsonb := '[]'::jsonb;
BEGIN
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;

  -- origine: esplicita > utente (manuale) > cron (auto)
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
      RAISE EXCEPTION 'Ruolo % non autorizzato alla sincronizzazione cassetto', COALESCE(v_role,'(nessuno)');
    END IF;
  END IF;

  IF p_stage NOT IN ('production','sandbox') THEN
    RAISE EXCEPTION 'Stage non valido: %', p_stage;
  END IF;
  IF p_stage = 'production' THEN
    v_login_url := 'https://common.api.acubeapi.com/login';
    v_base_url  := 'https://it.api.acubeapi.com';
  ELSE
    v_login_url := 'https://common-sandbox.api.acubeapi.com/login';
    v_base_url  := 'https://it-sandbox.api.acubeapi.com';
  END IF;

  v_since := COALESCE(NULLIF(p_since,''), to_char((now() - interval '35 days')::date, 'YYYY-MM-DD'));

  -- tenant senza config cassetto attiva → no-op silenzioso (Made/Zago non configurati)
  IF NOT EXISTS (
    SELECT 1 FROM public.acube_cassetto_fiscale_config
    WHERE stage = p_stage AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'no active cassetto config', 'inserted', 0);
  END IF;

  PERFORM set_config('statement_timeout','170000', true);
  PERFORM http_set_curlopt('CURLOPT_TIMEOUT','30');

  -- login A-Cube
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
    VALUES (v_company_id, 'cassetto_fiscale', v_origine, 'errore', 0, v_errmsg,
            (extract(epoch from clock_timestamp()-v_started)*1000)::int, now());
    RETURN jsonb_build_object('ok', false, 'error', v_errmsg, 'inserted', 0);
  END IF;

  -- una passata per ogni config cassetto attiva (fiscal_id dal DB, mai hardcoded)
  FOR v_cfg IN
    SELECT fiscal_id
    FROM public.acube_cassetto_fiscale_config
    WHERE stage = p_stage AND status = 'active'
  LOOP
    v_cfg_count := v_cfg_count + 1;
    v_page := 1;

    LOOP
      EXIT WHEN v_page > v_max_pages;
      SELECT * INTO v_resp FROM http((
        'GET',
        format('%s/invoices?fiscal_id=%s&updated_after=%s&itemsPerPage=100&page=%s',
               v_base_url, v_cfg.fiscal_id, v_since, v_page),
        ARRAY[http_header('Authorization','Bearer '||v_jwt), http_header('Accept','application/json')],
        NULL, NULL
      )::http_request);

      IF v_resp.status <> 200 THEN
        v_errmsg := concat_ws(' | ', v_errmsg,
          format('%s page %s HTTP %s: %s', v_cfg.fiscal_id, v_page, v_resp.status, LEFT(v_resp.content,150)));
        EXIT;
      END IF;

      v_arr := v_resp.content::jsonb;
      IF jsonb_typeof(v_arr) <> 'array' THEN
        v_arr := COALESCE(v_arr->'hydra:member', v_arr->'member', v_arr->'data', '[]'::jsonb);
      END IF;
      v_len := COALESCE(jsonb_array_length(v_arr), 0);
      EXIT WHEN v_len = 0;
      v_found := v_found + v_len;
      v_new_this_page := 0;

      FOR v_item IN SELECT * FROM jsonb_array_elements(v_arr) LOOP
        v_uuid := nullif(COALESCE(v_item->>'uuid', v_item->>'id'), '')::uuid;
        IF v_uuid IS NULL THEN CONTINUE; END IF;
        IF EXISTS (SELECT 1 FROM public.acube_sdi_invoices WHERE acube_uuid = v_uuid) THEN
          CONTINUE;
        END IF;

        -- payload: campo 'payload' se presente, altrimenti l'intero item (NOT NULL)
        v_payload := COALESCE(v_item->'payload', v_item);
        BEGIN
          v_doc := v_payload #> '{fattura_elettronica_body,0,dati_generali,dati_generali_documento}';
        EXCEPTION WHEN OTHERS THEN v_doc := NULL; END;

        v_direction := COALESCE(NULLIF(v_item->>'direction',''), NULLIF(v_item->>'type',''), 'passive');
        v_inv_num   := COALESCE(v_item->>'invoice_number', v_item->>'number', v_doc->>'numero');
        v_inv_date  := nullif(COALESCE(v_item->>'invoice_date', v_item->>'date', v_doc->>'data'), '')::date;
        v_total     := nullif(COALESCE(v_item->>'total_amount', v_item->>'totale', v_doc->>'importo_totale_documento'), '')::numeric;
        v_currency  := COALESCE(v_item->>'currency', v_doc->>'divisa', 'EUR');
        v_sender_name    := COALESCE(v_item->'sender'->>'name', v_item->'sender'->>'business_name', v_item->>'sender_name');
        v_sender_vat     := COALESCE(v_item->'sender'->>'vat', v_item->'sender'->>'business_vat_number_code', v_item->>'sender_vat');
        v_recipient_vat  := COALESCE(v_item->'recipient'->>'vat', v_item->'recipient'->>'business_vat_number_code', v_item->>'recipient_vat');
        v_recipient_name := COALESCE(v_item->'recipient'->>'name', v_item->'recipient'->>'business_name', v_item->>'recipient_name');

        INSERT INTO public.acube_sdi_invoices (
          acube_uuid, business_fiscal_id, direction, marking,
          document_type, invoice_number, invoice_date, currency, total_amount, to_pa,
          sender_vat, sender_country, sender_name, recipient_vat, recipient_name, recipient_code,
          downloaded, downloaded_at, payload, acube_created_at
        ) VALUES (
          v_uuid, v_cfg.fiscal_id, v_direction,
          COALESCE(v_item->>'marking', CASE WHEN v_direction = 'active' THEN 'sent' ELSE 'received' END),
          COALESCE(v_item->>'document_type', v_doc->>'tipo_documento'),
          v_inv_num, v_inv_date, v_currency, v_total,
          COALESCE((v_item->>'to_pa')::boolean, false),
          v_sender_vat, COALESCE(v_item->'sender'->>'country','IT'), v_sender_name,
          v_recipient_vat, v_recipient_name, v_item->'recipient'->>'code',
          true, now(), v_payload,
          nullif(COALESCE(v_item->>'created_at', v_item->>'createdAt'), '')::timestamptz
        );

        v_inserted := v_inserted + 1;
        v_new_this_page := v_new_this_page + 1;
        IF v_inv_date IS NOT NULL THEN
          v_min_date := least(COALESCE(v_min_date, v_inv_date), v_inv_date);
          v_max_date := greatest(COALESCE(v_max_date, v_inv_date), v_inv_date);
        END IF;

        v_details := v_details || jsonb_build_object(
          'label',        COALESCE(NULLIF(v_inv_num,''), LEFT(v_uuid::text,8)),
          'reference',    v_uuid::text,
          'counterparty', v_sender_name,
          'doc_date',     v_inv_date,
          'amount',       v_total,
          'currency',     v_currency
        );
      END LOOP;

      EXIT WHEN v_len < 100;   -- ultima pagina
      v_page := v_page + 1;
    END LOOP;
  END LOOP;

  -- aggiorna lo stato della config (osservabilità pannello A-Cube)
  UPDATE public.acube_cassetto_fiscale_config
    SET last_sync_at = now(),
        last_sync_invoices_count = v_inserted
    WHERE stage = p_stage AND status = 'active';

  v_status := CASE
    WHEN v_errmsg IS NOT NULL AND v_inserted > 0 THEN 'parziale'
    WHEN v_errmsg IS NOT NULL THEN 'errore'
    ELSE 'ok'   -- 0 nuovi documenti = ok (non errore)
  END::public.sync_status;

  INSERT INTO public.sync_runs(company_id, feed, origine, period_from, period_to, status, items_downloaded, error_message, duration_ms, run_at)
  VALUES (v_company_id, 'cassetto_fiscale', v_origine, v_min_date, v_max_date, v_status, v_inserted,
          CASE WHEN v_errmsg IS NOT NULL THEN LEFT(v_errmsg,4000) ELSE NULL END,
          (extract(epoch from clock_timestamp()-v_started)*1000)::int, now())
  RETURNING id INTO v_run_id;

  -- una riga di dettaglio per fattura scaricata
  INSERT INTO public.sync_run_details
    (sync_run_id, company_id, feed, detail_type, label, reference, counterparty, doc_date, amount, currency)
  SELECT v_run_id, v_company_id, 'cassetto_fiscale', 'fattura',
         d->>'label', d->>'reference', d->>'counterparty',
         nullif(d->>'doc_date','')::date, nullif(d->>'amount','')::numeric, d->>'currency'
  FROM jsonb_array_elements(v_details) AS d;

  RETURN jsonb_build_object('ok', v_errmsg IS NULL, 'inserted', v_inserted, 'found', v_found,
                            'configs', v_cfg_count, 'since', v_since, 'status', v_status, 'error', v_errmsg);
EXCEPTION WHEN OTHERS THEN
  IF v_company_id IS NOT NULL THEN
    INSERT INTO public.sync_runs(company_id, feed, origine, status, items_downloaded, error_message, duration_ms, run_at)
    VALUES (v_company_id, 'cassetto_fiscale', COALESCE(v_origine,'auto_cron'), 'errore', v_inserted, LEFT(SQLERRM,4000),
            (extract(epoch from clock_timestamp()-v_started)*1000)::int, now());
  END IF;
  RAISE;
END;
$function$;

-- Sicurezza: chiamate esterne + scrittura → mai eseguibile da anon.
REVOKE ALL ON FUNCTION public.acube_cf_sync_inbound_production(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acube_cf_sync_inbound_production(text,text,text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- Cron: una volta al giorno (feed cassetto = giornaliero). Sfasato dagli altri
-- cron A-Cube (banche :00, sdi passive :30, sdi attive :45) per non collidere
-- sul login A-Cube: 05:15 UTC.
-- ─────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'acube-cf-sync-inbound-daily',
  '15 5 * * *',
  $cron$ SELECT public.acube_cf_sync_inbound_production('production','auto_cron', NULL); $cron$
);
