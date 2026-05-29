-- Migration 051 — Unifica dedup bank_transactions per evitare doppi cross-source A-Cube.
--
-- ROOT CAUSE (ticket NZ 5f0cdd93):
--   3 sorgenti scrivevano in bank_transactions con formule di hash diverse:
--     1. Edge function `acube-ob-tx-sync` (TS, click "Aggiorna") -> source='acube_ob',
--        hash = `${acc}|${txid}|${date}|${amount}` (testo)
--     2. Trigger `trg_sync_acube_tx_to_bank` su acube_transactions (migration 029)
--        -> source='api_acube_ob', hash = NEW.dedup_hash di acube_transactions
--     3. Cron RPC `acube_ob_sync_all_production()` (ogni 6h)
--        -> source='acube_ob', hash = md5(acc||txid||madeOn)
--   Hash distinti => UNIQUE non scatta => doppioni anche x12.
--   Aggravante: A-Cube ribatte transactionId tra paginate, quindi anche hash che includono txid
--   generano nuovi insert dello stesso movimento.
--
-- FIX:
--   A. Helper canonical hash IMMUTABLE indipendente da txid e source.
--   B. Drop trigger #2 (causa source duplicato 'api_acube_ob').
--   C. Cleanup duplicati esistenti (idempotente, gestione orfani senza FK reverse).
--   D. Rinormalizza tutti gli hash esistenti con canonical.
--   E. UNIQUE INDEX (partial: solo dove hash IS NOT NULL).
--   F. Riscrivi cron RPC #3 per usare canonical hash + ON CONFLICT DO NOTHING.
--   La edge function #1 viene aggiornata in parallelo (`acube-ob-tx-sync` v3).

-- A) Helper canonical hash
CREATE OR REPLACE FUNCTION public.bank_transaction_canonical_hash(
  p_account_id UUID, p_date DATE, p_amount NUMERIC, p_description TEXT
) RETURNS TEXT
LANGUAGE SQL IMMUTABLE
SET search_path = public
AS $$
  SELECT MD5(
    COALESCE(p_account_id::text, '') || '|' ||
    COALESCE(p_date::text, '') || '|' ||
    COALESCE(to_char(p_amount, 'FM999999999999990.00'), '') || '|' ||
    LEFT(COALESCE(p_description, ''), 40)
  )
$$;

-- C) Cleanup duplicati esistenti (idempotente)
WITH grouped AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY bank_account_id, transaction_date, amount, LEFT(COALESCE(description,''),40)
      ORDER BY
        (is_reconciled IS TRUE) DESC,
        (invoice_id IS NOT NULL OR reconciled_invoice_id IS NOT NULL OR payment_schedule_id IS NOT NULL OR supplier_id IS NOT NULL) DESC,
        created_at ASC
    ) AS rn
  FROM bank_transactions
)
DELETE FROM bank_transactions WHERE id IN (SELECT id FROM grouped WHERE rn > 1);

-- B) Drop trigger #2 + funzione
DROP TRIGGER IF EXISTS trg_sync_acube_tx_to_bank ON public.acube_transactions;
DROP FUNCTION IF EXISTS public.sync_acube_transaction_to_bank_transaction();

-- D) Rinormalizza hash su tutte le righe rimaste
UPDATE public.bank_transactions
SET acube_dedup_hash = public.bank_transaction_canonical_hash(bank_account_id, transaction_date, amount, description)
WHERE bank_account_id IS NOT NULL AND transaction_date IS NOT NULL AND amount IS NOT NULL;

UPDATE public.bank_transactions SET source = 'acube_ob' WHERE source = 'api_acube_ob';

-- E) UNIQUE INDEX (partial)
DROP INDEX IF EXISTS public.bank_transactions_acube_dedup_uq;
CREATE UNIQUE INDEX bank_transactions_acube_dedup_uq
  ON public.bank_transactions (acube_dedup_hash)
  WHERE acube_dedup_hash IS NOT NULL;

-- F) Riscrive cron RPC: drop e ricreate (cambia firma return type)
DROP FUNCTION IF EXISTS public.acube_ob_sync_all_production();

CREATE FUNCTION public.acube_ob_sync_all_production()
RETURNS TABLE(fiscal_id TEXT, accounts INT, transactions INT, error TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creds RECORD;
  v_jwt TEXT;
  v_login_resp http_response;
  v_acc_resp http_response;
  v_tx_resp http_response;
  v_br RECORD;
  v_acc JSONB;
  v_tx JSONB;
  v_hash TEXT;
  v_bank_id UUID;
  v_company_id UUID;
  v_acc_count INT;
  v_tx_count INT;
  v_err TEXT;
  v_inserted INT;
BEGIN
  SELECT email, password INTO v_creds FROM get_acube_credentials('production') LIMIT 1;
  SELECT * INTO v_login_resp FROM http(('POST',
    'https://common.api.acubeapi.com/login',
    ARRAY[http_header('Accept','application/json')],
    'application/json',
    json_build_object('email', v_creds.email, 'password', v_creds.password)::text
  )::http_request);
  v_jwt := (v_login_resp.content::jsonb)->>'token';
  IF v_jwt IS NULL THEN
    RETURN QUERY SELECT 'LOGIN'::text, 0, 0, 'login_failed: ' || COALESCE(LEFT(v_login_resp.content,200), 'no body');
    RETURN;
  END IF;

  SELECT id INTO v_company_id FROM public.companies LIMIT 1;

  FOR v_br IN
    SELECT uuid AS br_uuid, fiscal_id, business_name
    FROM acube_business_registries
    WHERE stage = 'production' AND enabled = true
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
          UPDATE bank_accounts SET current_balance = (v_acc->>'balance')::numeric, balance_updated_at = now(),
            is_active = (v_acc->>'enabled')::boolean, updated_at = now()
          WHERE acube_account_uuid = (v_acc->>'uuid')::uuid;
          IF NOT FOUND THEN
            INSERT INTO bank_accounts (company_id, bank_name, iban, account_name, account_type, currency,
              is_active, is_manual, current_balance, balance_updated_at, acube_account_uuid)
            VALUES (v_company_id, COALESCE(v_acc->>'providerName', 'Banca'), v_acc->>'iban',
              COALESCE(v_acc->>'name', v_acc->>'iban'), 'conto_corrente', v_acc->>'currencyCode',
              true, false, (v_acc->>'balance')::numeric, now(), (v_acc->>'uuid')::uuid);
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
            SELECT id INTO v_bank_id FROM bank_accounts WHERE acube_account_uuid = (v_acc->>'uuid')::uuid LIMIT 1;
            FOR v_tx IN SELECT t FROM jsonb_array_elements(v_tx_resp.content::jsonb) AS t(t) LOOP
              v_hash := public.bank_transaction_canonical_hash(
                v_bank_id, (LEFT(v_tx->>'madeOn',10))::date,
                (v_tx->>'amount')::numeric, v_tx->>'description'
              );
              INSERT INTO bank_transactions (
                company_id, bank_account_id, transaction_date, booking_date, value_date,
                amount, currency, description, status, source, acube_dedup_hash, raw_data, is_reconciled
              ) VALUES (
                v_company_id, v_bank_id,
                (LEFT(v_tx->>'madeOn',10))::date, (LEFT(v_tx->>'madeOn',10))::date, (LEFT(v_tx->>'madeOn',10))::date,
                (v_tx->>'amount')::numeric, v_tx->>'currencyCode', v_tx->>'description',
                'booked', 'acube_ob', v_hash, v_tx, false
              ) ON CONFLICT (acube_dedup_hash) DO NOTHING;
              GET DIAGNOSTICS v_inserted = ROW_COUNT;
              v_tx_count := v_tx_count + v_inserted;
            END LOOP;
          END IF;
        END LOOP;
      ELSE
        v_err := format('accounts HTTP %s: %s', v_acc_resp.status, LEFT(v_acc_resp.content, 150));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;
    RETURN QUERY SELECT v_br.fiscal_id, v_acc_count, v_tx_count, v_err;
  END LOOP;
END;
$$;
