-- 096 — dettaglio banche per BANCA REALE (non per azienda)
--
-- PROBLEMA: nelle run banche NUOVE il riepilogo "Per banca" mostrava il nome
-- dell'AZIENDA (business_name del business registry A-Cube) aggregando i conti
-- di banche diverse in un'unica riga (es. "New Zago Srl", 3 conti). L'utente
-- vuole vedere la BANCA da cui provengono i movimenti (BCC, Intesa, MPS…).
--
-- FIX: la funzione OB ora costruisce il dettaglio raggruppando i conti acube
-- ATTIVI per bank_name reale (movimenti = quelli agganciati alla run; saldo =
-- saldo reale al momento della sync). Include tutte le banche collegate, anche
-- quelle con 0 movimenti nuovi. Poi si ricostruisce il dettaglio delle run
-- forward già scritte con il vecchio raggruppamento.
--
-- Additivo/reversibile (solo tabella derivata sync_run_details + CREATE OR
-- REPLACE funzione). Idempotente.
--
-- ⚠️ PARITÀ TENANT: NZ + Made + Zago. Richiede 092+093+094+095.

-- ─── 1. OB: dettaglio per banca reale ────────────────────────────────────
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
  v_started TIMESTAMPTZ := clock_timestamp();
  v_tot_tx INT := 0;
  v_err_agg TEXT := NULL;
  v_run_id UUID;
  -- id dei movimenti inseriti in questa run (per tagging)
  v_all_ids UUID[] := '{}';
  v_batch UUID[];
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
            WITH ins AS (
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
              ON CONFLICT (acube_dedup_hash) WHERE acube_dedup_hash IS NOT NULL DO NOTHING
              RETURNING id
            )
            SELECT COALESCE(array_agg(id), '{}') INTO v_batch FROM ins;
            v_inserted := COALESCE(array_length(v_batch, 1), 0);
            v_all_ids := v_all_ids || v_batch;
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
          (extract(epoch from clock_timestamp()-v_started)*1000)::int, now())
  RETURNING id INTO v_run_id;

  -- tagga i movimenti inseriti in questa run
  IF array_length(v_all_ids, 1) > 0 THEN
    UPDATE public.bank_transactions SET sync_run_id = v_run_id WHERE id = ANY(v_all_ids);
  END IF;

  -- una riga di dettaglio per BANCA REALE (nome banca, non azienda): raggruppa
  -- i conti acube ATTIVI per bank_name; movimenti = quelli agganciati alla run,
  -- saldo = saldo reale del conto al momento della sync. Include anche le banche
  -- con 0 movimenti nuovi.
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

-- ─── 2. Ricostruisce il dettaglio delle run forward già scritte ──────────
-- (quelle create dopo l'attivazione, col vecchio raggruppamento per azienda)
DELETE FROM public.sync_run_details
WHERE feed = 'banche' AND detail_type = 'banca'
  AND sync_run_id IN (
    SELECT id FROM public.sync_runs
    WHERE feed = 'banche' AND run_at >= timestamptz '2026-07-15 10:00:00+00'
  );

INSERT INTO public.sync_run_details
  (sync_run_id, company_id, feed, detail_type, label, reference, items_count, amount, extra)
SELECT s.id, s.company_id, 'banche', 'banca',
       COALESCE(NULLIF(ba.bank_name,''), 'Banca'),
       min(ba.iban),
       COALESCE(sum(m.cnt), 0)::int,
       sum(ba.current_balance),
       jsonb_build_object('accounts', count(*)::int)
FROM public.sync_runs s
JOIN public.bank_accounts ba ON ba.company_id = s.company_id
     AND ba.acube_account_uuid IS NOT NULL AND ba.is_active
LEFT JOIN LATERAL (
  SELECT count(*)::int AS cnt FROM public.bank_transactions bt
  WHERE bt.bank_account_id = ba.id AND bt.sync_run_id = s.id
) m ON true
WHERE s.feed = 'banche' AND s.run_at >= timestamptz '2026-07-15 10:00:00+00'
GROUP BY s.id, s.company_id, ba.bank_name;
