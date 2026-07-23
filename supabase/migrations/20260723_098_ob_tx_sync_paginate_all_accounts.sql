-- 098 — Open Banking: fix scarico movimenti (paginazione completa, tutti i conti)
--
-- PROBLEMA (diagnosi 2026-07-23):
--   acube_ob_sync_all_production scaricava i movimenti con, PER OGNI conto:
--     GET /business-registry/{fid}/transactions?account={uuid}&itemsPerPage=100
--   con Accept: application/json e SENZA paginazione. Due difetti gravi di A-Cube
--   verificati sul campo:
--     1. il parametro `account=` è IGNORATO dall'endpoint OB: restituisce i
--        movimenti di TUTTI i conti mischiati (la P.IVA), non del conto richiesto;
--     2. con Accept: application/json la risposta è un array semplice senza
--        paginazione hydra, quindi si leggeva SOLO la prima pagina (100 movimenti).
--   Effetto: si importavano solo i ~100 movimenti globali più "in cima", e i conti
--   ad alto volume (MPS) saturavano quella pagina affamando gli altri. Conseguenze
--   reali riscontrate: conto "Banco Fiorentino" appena collegato con saldo ma
--   0 movimenti; Intesa con pochissimi movimenti; sistematicamente meno movimenti
--   di quelli reali visti in banca.
--
-- FIX:
--   Con Accept: application/ld+json l'endpoint espone hydra (hydra:member,
--   hydra:totalItems, hydra:view.hydra:next) e il filtro `madeOn[strictly_after]`
--   FUNZIONA (a differenza di `account=`). Quindi:
--     • si scaricano i movimenti UNA volta per business registry (non più per
--       conto), con `madeOn[strictly_after]={since}` e PAGINAZIONE completa;
--     • ogni movimento viene attribuito al conto giusto tramite l'`account.uuid`
--       presente nel movimento (JOIN su bank_accounts.acube_account_uuid), come già
--       si faceva;
--     • dedup invariato (bank_tx_canonical_hash_occ + ON CONFLICT DO NOTHING), con
--       la row_number() calcolata sull'INTERO set scaricato (non per-pagina) per
--       coerenza dell'hash di occorrenza.
--   Nuovo parametro `p_since` (default: ultimi 120 giorni) per il cron e per
--   eventuali backfill (data più larga). Il loop conti resta SOLO per l'upsert di
--   conti e saldi (che già funzionava).
--
-- SICUREZZA / NO DATA LOSS: solo INSERT idempotente + UPDATE saldi + logging.
--   Nessun DELETE/DROP di dati. La firma passa da () a (text DEFAULT NULL): il cron
--   `SELECT * FROM acube_ob_sync_all_production()` continua a funzionare (default).
--
-- ⚠️ PARITÀ TENANT: applicare su NZ + Made + Zago (3 project_id).

DROP FUNCTION IF EXISTS public.acube_ob_sync_all_production();

CREATE OR REPLACE FUNCTION public.acube_ob_sync_all_production(p_since text DEFAULT NULL)
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
  v_started TIMESTAMPTZ := clock_timestamp();
  v_tot_tx INT := 0;
  v_err_agg TEXT := NULL;
  v_run_id UUID;
  v_all_ids UUID[] := '{}';
  v_batch UUID[];
  -- paginazione movimenti
  v_since TEXT;
  v_page INT;
  v_max_pages INT := 60;
  v_all_tx JSONB;
  v_items JSONB;
  v_len INT;
BEGIN
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;

  -- finestra temporale: default ultimi 120 giorni (self-heal + volume gestibile);
  -- un backfill può passare una data più larga (A-Cube ha comunque una retention).
  v_since := COALESCE(NULLIF(p_since,''), to_char((now() - interval '120 days')::date, 'YYYY-MM-DD'));

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
      -- ─── 1. Conti + saldi (loop per conto: qui il per-account è corretto) ───
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
        END LOOP;

        -- ─── 2. Movimenti: UNA passata paginata per business registry ─────────
        -- `account=` è ignorato da A-Cube → si scaricano TUTTI i movimenti della
        -- P.IVA (ld+json, filtro madeOn, paginazione hydra) e si attribuiscono al
        -- conto giusto tramite account.uuid.
        v_all_tx := '[]'::jsonb;
        v_page := 1;
        LOOP
          EXIT WHEN v_page > v_max_pages;
          SELECT * INTO v_tx_resp FROM http((
            'GET',
            format('https://ob.api.acubeapi.com/business-registry/%s/transactions?madeOn[strictly_after]=%s&itemsPerPage=100&page=%s',
                   v_br.fiscal_id, v_since, v_page),
            ARRAY[http_header('Authorization','Bearer '||v_jwt), http_header('Accept','application/ld+json')],
            NULL, NULL
          )::http_request);
          EXIT WHEN v_tx_resp.status <> 200;
          v_items := (v_tx_resp.content::jsonb)->'hydra:member';
          v_len := COALESCE(jsonb_array_length(v_items), 0);
          EXIT WHEN v_len = 0;
          v_all_tx := v_all_tx || v_items;
          EXIT WHEN v_len < 100;   -- ultima pagina
          v_page := v_page + 1;
        END LOOP;

        IF jsonb_array_length(v_all_tx) > 0 THEN
          WITH ins AS (
            INSERT INTO bank_transactions (
              company_id, bank_account_id, transaction_date, booking_date, value_date,
              amount, currency, description, status, source, acube_transaction_id, raw_data, is_reconciled,
              acube_dedup_hash
            )
            SELECT v_company_id, ba.id,
              (LEFT(x->>'madeOn',10))::date, (LEFT(x->>'madeOn',10))::date, (LEFT(x->>'madeOn',10))::date,
              (x->>'amount')::numeric, x->>'currencyCode', x->>'description',
              'booked', 'acube_ob', x->>'transactionId', x, false,
              public.bank_tx_canonical_hash_occ(
                ba.id, (LEFT(x->>'madeOn',10))::date, (x->>'amount')::numeric, x->>'description',
                (row_number() OVER (
                  PARTITION BY ba.id, LEFT(x->>'madeOn',10), x->>'amount', LEFT(COALESCE(x->>'description',''),40)
                  ORDER BY x->>'transactionId'))::int
              )
            FROM jsonb_array_elements(v_all_tx) AS x
            JOIN bank_accounts ba ON ba.company_id = v_company_id
                                 AND ba.acube_account_uuid = (x->'account'->>'uuid')::uuid
            ON CONFLICT (acube_dedup_hash) WHERE acube_dedup_hash IS NOT NULL DO NOTHING
            RETURNING id
          )
          SELECT COALESCE(array_agg(id), '{}') INTO v_batch FROM ins;
          v_tx_count := COALESCE(array_length(v_batch, 1), 0);
          v_all_ids := v_all_ids || v_batch;
        END IF;
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
          (extract(epoch from clock_timestamp()-v_started)*1000)::int, now())
  RETURNING id INTO v_run_id;

  -- tagga i movimenti inseriti in questa run
  IF array_length(v_all_ids, 1) > 0 THEN
    UPDATE public.bank_transactions SET sync_run_id = v_run_id WHERE id = ANY(v_all_ids);
  END IF;

  -- dettaglio per BANCA REALE (nome banca): movimenti = quelli agganciati alla run,
  -- saldo = saldo reale del conto. Include anche le banche con 0 movimenti nuovi.
  INSERT INTO public.sync_run_details
    (sync_run_id, company_id, feed, detail_type, label, reference, items_count, amount, extra)
  SELECT v_run_id, v_company_id, 'banche', 'banca',
         COALESCE(NULLIF(ba.bank_name,''), 'Banca'),
         min(ba.iban),
         COALESCE(sum(m.cnt), 0)::int,
         sum(ba.current_balance),
         jsonb_build_object('accounts', count(*)::int)
  FROM public.bank_accounts ba
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS cnt FROM public.bank_transactions bt
    WHERE bt.bank_account_id = ba.id AND bt.sync_run_id = v_run_id
  ) m ON true
  WHERE ba.company_id = v_company_id
    AND ba.acube_account_uuid IS NOT NULL
    AND ba.is_active
  GROUP BY ba.bank_name;
END;
$function$;
