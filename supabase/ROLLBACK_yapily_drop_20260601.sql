-- ============================================================================
-- ROLLBACK / BACKUP DDL — Yapily cleanup (DROP tabelle)
-- Generato: 2026-06-01 (sessione cleanup Yapily)
-- Scopo: ripristinare yapily_consents / yapily_accounts / yapily_payments
--        e la FK bank_transactions.account_id -> yapily_accounts(id)
--        in caso servisse annullare il DROP.
-- Stato al momento del DROP: tutte le 3 tabelle a 0 righe su NZ/Made/Zago;
--        bank_transactions.account_id 100% NULL (0 valori su 753 righe NZ).
-- Applicare su ciascun tenant: NZ xfvfxsvqpnpvibgeqpqp / Made wdgoebzvosspjqttitra / Zago jxlwvzjreukscnswkbjx
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS yapily_consents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  institution_id text NOT NULL,
  institution_name text NOT NULL,
  consent_token text NOT NULL,
  consent_type text NOT NULL,
  status text DEFAULT 'PENDING',
  expires_at timestamptz,
  max_historical_days integer DEFAULT 90,
  user_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT yapily_consents_pkey PRIMARY KEY (id),
  CONSTRAINT yapily_consents_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT yapily_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT yapily_consents_consent_type_check CHECK ((consent_type = ANY (ARRAY['AIS'::text, 'PIS'::text]))),
  CONSTRAINT yapily_consents_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'AUTHORIZED'::text, 'EXPIRED'::text, 'REVOKED'::text, 'REJECTED'::text])))
);
CREATE INDEX IF NOT EXISTS idx_yapily_consents_company ON public.yapily_consents USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_yapily_consents_institution ON public.yapily_consents USING btree (institution_id);
CREATE INDEX IF NOT EXISTS idx_yapily_consents_status ON public.yapily_consents USING btree (status);

CREATE TABLE IF NOT EXISTS yapily_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  consent_id uuid NOT NULL,
  yapily_account_id text NOT NULL,
  account_type text,
  account_name text,
  iban text,
  currency text DEFAULT 'EUR',
  institution_id text NOT NULL,
  bank_account_id uuid,
  balance numeric,
  balance_updated_at timestamptz,
  last_synced_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT yapily_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT yapily_accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT yapily_accounts_consent_id_fkey FOREIGN KEY (consent_id) REFERENCES yapily_consents(id) ON DELETE CASCADE,
  CONSTRAINT yapily_accounts_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_yapily_accounts_company ON public.yapily_accounts USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_yapily_accounts_consent ON public.yapily_accounts USING btree (consent_id);
CREATE INDEX IF NOT EXISTS idx_yapily_accounts_iban ON public.yapily_accounts USING btree (iban);
CREATE UNIQUE INDEX IF NOT EXISTS idx_yapily_accounts_unique ON public.yapily_accounts USING btree (company_id, yapily_account_id);

CREATE TABLE IF NOT EXISTS yapily_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  consent_id uuid,
  payable_id uuid,
  idempotency_key uuid DEFAULT gen_random_uuid(),
  amount numeric NOT NULL,
  currency text DEFAULT 'EUR',
  creditor_name text NOT NULL,
  creditor_iban text NOT NULL,
  reference text,
  payment_type text DEFAULT 'DOMESTIC_SINGLE',
  status text DEFAULT 'PENDING',
  yapily_payment_id text,
  initiated_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  error_details jsonb,
  CONSTRAINT yapily_payments_pkey PRIMARY KEY (id),
  CONSTRAINT yapily_payments_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT yapily_payments_consent_id_fkey FOREIGN KEY (consent_id) REFERENCES yapily_consents(id),
  CONSTRAINT yapily_payments_payable_id_fkey FOREIGN KEY (payable_id) REFERENCES payables(id),
  CONSTRAINT yapily_payments_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'AUTHORIZED'::text, 'COMPLETED'::text, 'FAILED'::text, 'REJECTED'::text])))
);
CREATE INDEX IF NOT EXISTS idx_yapily_payments_company ON public.yapily_payments USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_yapily_payments_payable ON public.yapily_payments USING btree (payable_id);
CREATE INDEX IF NOT EXISTS idx_yapily_payments_status ON public.yapily_payments USING btree (status);

-- RLS
ALTER TABLE yapily_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE yapily_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE yapily_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY yapily_consents_select ON yapily_consents FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY yapily_consents_write  ON yapily_consents FOR ALL USING ((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role])));
CREATE POLICY yapily_accounts_select ON yapily_accounts FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY yapily_accounts_write  ON yapily_accounts FOR ALL USING ((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role])));
CREATE POLICY yapily_payments_select ON yapily_payments FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY yapily_payments_write  ON yapily_payments FOR ALL USING ((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role])));

-- FK su bank_transactions (la colonna account_id NON e' stata droppata)
ALTER TABLE bank_transactions
  ADD CONSTRAINT bank_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES yapily_accounts(id);

COMMIT;
