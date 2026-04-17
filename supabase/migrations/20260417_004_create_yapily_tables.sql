-- ============================================================
-- Fase 2.1 — Tabelle Open Banking Yapily
-- 4 tabelle: consents, accounts, transactions, payments
-- Applicata su Supabase: 2026-04-17
-- ============================================================

CREATE TABLE public.yapily_consents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES companies(id) NOT NULL,
    institution_id TEXT NOT NULL,
    institution_name TEXT NOT NULL,
    consent_token TEXT NOT NULL,
    consent_type TEXT NOT NULL CHECK (consent_type IN ('AIS', 'PIS')),
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING','AUTHORIZED','EXPIRED','REVOKED','REJECTED')),
    expires_at TIMESTAMPTZ,
    max_historical_days INT DEFAULT 90,
    user_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_yapily_consents_company ON public.yapily_consents(company_id);
CREATE INDEX idx_yapily_consents_status ON public.yapily_consents(status);
ALTER TABLE public.yapily_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "yapily_consents_select" ON public.yapily_consents FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "yapily_consents_write" ON public.yapily_consents FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

CREATE TABLE public.yapily_accounts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES companies(id) NOT NULL,
    consent_id UUID REFERENCES yapily_consents(id) ON DELETE CASCADE NOT NULL,
    yapily_account_id TEXT NOT NULL,
    account_type TEXT, account_name TEXT, iban TEXT,
    currency TEXT DEFAULT 'EUR', institution_id TEXT NOT NULL,
    bank_account_id UUID REFERENCES bank_accounts(id),
    balance NUMERIC(15,2), balance_updated_at TIMESTAMPTZ,
    last_synced_at TIMESTAMPTZ, is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_yapily_accounts_company ON public.yapily_accounts(company_id);
CREATE UNIQUE INDEX idx_yapily_accounts_unique ON public.yapily_accounts(company_id, yapily_account_id);
ALTER TABLE public.yapily_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "yapily_accounts_select" ON public.yapily_accounts FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "yapily_accounts_write" ON public.yapily_accounts FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

CREATE TABLE public.yapily_transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES companies(id) NOT NULL,
    yapily_account_id UUID REFERENCES yapily_accounts(id) ON DELETE CASCADE NOT NULL,
    transaction_id TEXT NOT NULL, date DATE NOT NULL, booking_date DATE,
    amount NUMERIC(15,2) NOT NULL, currency TEXT DEFAULT 'EUR',
    description TEXT, reference TEXT, merchant_name TEXT, category TEXT,
    status TEXT CHECK (status IN ('BOOKED','PENDING')),
    balance_after NUMERIC(15,2), raw_data JSONB,
    cash_movement_id UUID REFERENCES cash_movements(id),
    reconciled BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_yapily_transactions_company ON public.yapily_transactions(company_id);
CREATE INDEX idx_yapily_transactions_date ON public.yapily_transactions(date DESC);
CREATE UNIQUE INDEX idx_yapily_transactions_unique ON public.yapily_transactions(company_id, yapily_account_id, transaction_id);
ALTER TABLE public.yapily_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "yapily_transactions_select" ON public.yapily_transactions FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "yapily_transactions_write" ON public.yapily_transactions FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

CREATE TABLE public.yapily_payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES companies(id) NOT NULL,
    consent_id UUID REFERENCES yapily_consents(id),
    payable_id UUID REFERENCES payables(id),
    idempotency_key UUID DEFAULT gen_random_uuid(),
    amount NUMERIC(15,2) NOT NULL, currency TEXT DEFAULT 'EUR',
    creditor_name TEXT NOT NULL, creditor_iban TEXT NOT NULL,
    reference TEXT, payment_type TEXT DEFAULT 'DOMESTIC_SINGLE',
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING','AUTHORIZED','COMPLETED','FAILED','REJECTED')),
    yapily_payment_id TEXT,
    initiated_at TIMESTAMPTZ DEFAULT now(), completed_at TIMESTAMPTZ,
    error_details JSONB
);
CREATE INDEX idx_yapily_payments_company ON public.yapily_payments(company_id);
ALTER TABLE public.yapily_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "yapily_payments_select" ON public.yapily_payments FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "yapily_payments_write" ON public.yapily_payments FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));
