-- 093 — movimenti nel dettaglio + ricostruzione storico
--
-- PARTE 1 (forward): traccia il singolo movimento bancario scaricato.
--   Nuova colonna bank_transactions.sync_run_id (nullable, FK→sync_runs).
--   acube_ob_sync_all_production tagga i movimenti inseriti con la run corrente.
--
-- PARTE 2 (storico, best-effort): i dati scaricati in passato ESISTONO già
--   (bank_transactions source='acube_ob', electronic_invoices acube). Li
--   riattribuiamo alle run esistenti per PROSSIMITÀ TEMPORALE: ogni item viene
--   legato alla run dello stesso feed con run_at più vicino al suo created_at
--   (finestra ±15'). Per il cron l'attribuzione è esatta (created_at ed run_at
--   nascono dallo stesso now() nella stessa transazione); per i sync manuali è
--   approssimata ma affidabile (le run distano ore). Poi si ricostruiscono i
--   riepiloghi in sync_run_details per le run storiche che ne sono prive.
--
-- SICUREZZA: tutto ADDITIVO e reversibile. Si scrive SOLO su:
--   • la nuova colonna nullable bank_transactions.sync_run_id (nessun dato
--     esistente toccato)
--   • la tabella derivata sync_run_details (osservabilità, non dato "vivo")
--   Nessun DELETE/DROP. Idempotente (WHERE sync_run_id IS NULL / NOT EXISTS).
--   Il saldo storico per banca è approssimato con il saldo corrente del conto
--   (lo storico dei saldi non è disponibile): è un'indicazione, non un dato
--   contabile.
--
-- ⚠️ PARITÀ TENANT: applicare A MANO su NZ + Made + Zago. Richiede la 092.

-- ─── PARTE 1a — colonna di collegamento movimento → run ──────────────────
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS sync_run_id uuid REFERENCES public.sync_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_sync_run
  ON public.bank_transactions (sync_run_id) WHERE sync_run_id IS NOT NULL;

-- ─── PARTE 1b — OB: tagga i movimenti inseriti con la run ────────────────
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
  -- logging dettaglio per banca
  v_run_id UUID;
  v_details JSONB := '[]'::jsonb;
  v_bank_balance NUMERIC;
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
    v_acc_count := 0; v_tx_count := 0; v_err := NULL; v_bank_balance := NULL;

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
          v_bank_balance := COALESCE(v_bank_balance, 0) + COALESCE((v_acc->>'balance')::numeric, 0);

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

    v_details := v_details || jsonb_build_object(
      'label',     COALESCE(NULLIF(v_br.business_name,''), v_br.fiscal_id),
      'reference', v_br.fiscal_id,
      'accounts',  v_acc_count,
      'items',     v_tx_count,
      'balance',   v_bank_balance,
      'error',     v_err
    );

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

  -- una riga di dettaglio per banca
  INSERT INTO public.sync_run_details
    (sync_run_id, company_id, feed, detail_type, label, reference, items_count, amount, error_message, extra)
  SELECT v_run_id, v_company_id, 'banche', 'banca',
         d->>'label', d->>'reference',
         COALESCE((d->>'items')::int, 0),
         NULLIF(d->>'balance','')::numeric,
         d->>'error',
         jsonb_build_object('accounts', COALESCE((d->>'accounts')::int, 0))
  FROM jsonb_array_elements(v_details) AS d;
END;
$function$;

-- ─── PARTE 2a — storico: tagga i movimenti acube_ob passati ──────────────
-- Ogni movimento acube_ob senza run viene legato alla run 'banche' col run_at
-- più vicino al suo created_at (finestra ±15'). Solo colonne certe.
UPDATE public.bank_transactions bt
SET sync_run_id = (
  SELECT s.id FROM public.sync_runs s
  WHERE s.feed = 'banche'
    AND s.company_id = bt.company_id
    AND s.run_at BETWEEN bt.created_at - interval '15 minutes' AND bt.created_at + interval '15 minutes'
  ORDER BY abs(extract(epoch FROM (s.run_at - bt.created_at)))
  LIMIT 1
)
WHERE bt.source = 'acube_ob'
  AND bt.sync_run_id IS NULL
  AND bt.created_at IS NOT NULL;

-- ─── PARTE 2b — storico: riepilogo per banca sulle run senza dettaglio ────
INSERT INTO public.sync_run_details
  (sync_run_id, company_id, feed, detail_type, label, reference, items_count, amount, extra)
SELECT bt.sync_run_id, bt.company_id, 'banche', 'banca',
       COALESCE(NULLIF(ba.bank_name,''), 'Banca'),
       ba.iban,
       count(*)::int,
       max(ba.current_balance),
       jsonb_build_object('accounts', count(DISTINCT bt.bank_account_id)::int)
FROM public.bank_transactions bt
JOIN public.bank_accounts ba ON ba.id = bt.bank_account_id
WHERE bt.sync_run_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.sync_run_details d WHERE d.sync_run_id = bt.sync_run_id)
GROUP BY bt.sync_run_id, bt.company_id, ba.bank_name, ba.iban;

-- ─── PARTE 2c — storico: fatture per run senza dettaglio ─────────────────
-- Attribuisce le fatture acube esistenti (una riga per fattura) alle run
-- 'fatture_passive' per prossimità temporale. Usa solo colonne certe di
-- electronic_invoices.
INSERT INTO public.sync_run_details
  (sync_run_id, company_id, feed, detail_type, label, reference, counterparty, doc_date, amount, currency)
SELECT sr.id, ei.company_id, 'fatture_passive', 'fattura',
       COALESCE(NULLIF(ei.invoice_number,''), LEFT(ei.id::text, 8)),
       ei.id::text,
       ei.supplier_name,
       ei.invoice_date,
       ei.gross_amount,
       'EUR'
FROM public.electronic_invoices ei
JOIN LATERAL (
  SELECT s.id FROM public.sync_runs s
  WHERE s.feed = 'fatture_passive'
    AND s.company_id = ei.company_id
    AND s.run_at BETWEEN ei.created_at - interval '15 minutes' AND ei.created_at + interval '15 minutes'
  ORDER BY abs(extract(epoch FROM (s.run_at - ei.created_at)))
  LIMIT 1
) sr ON true
WHERE ei.created_at IS NOT NULL
  AND ei.source::text ILIKE '%acube%'
  AND NOT EXISTS (SELECT 1 FROM public.sync_run_details d WHERE d.sync_run_id = sr.id);
