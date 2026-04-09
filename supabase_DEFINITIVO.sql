-- ============================================================
-- GESTIONALE NEW ZAGO - SQL DEFINITIVO COMPLETO
-- Unico file da eseguire in Supabase SQL Editor
-- Gestisce sia tabelle nuove che già esistenti
-- ============================================================
-- NOTA: eseguire TUTTO in un unico blocco nel SQL Editor
-- ============================================================

-- ========================================
-- PARTE 1: CREA TUTTE LE TABELLE
-- (IF NOT EXISTS = salta se già presente)
-- ========================================

-- 1. DATI AZIENDA
CREATE TABLE IF NOT EXISTS company_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  ragione_sociale TEXT NOT NULL DEFAULT 'NEW ZAGO S.R.L.',
  forma_giuridica TEXT,
  sede_legale TEXT,
  partita_iva TEXT,
  codice_fiscale TEXT,
  rea TEXT,
  capitale_sociale TEXT,
  data_costituzione TEXT,
  pec TEXT,
  codice_sdi TEXT,
  ateco TEXT,
  amministratore TEXT,
  note TEXT,
  soci JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id)
);

-- 2. CENTRI DI COSTO
CREATE TABLE IF NOT EXISTS cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  color TEXT DEFAULT 'bg-slate-600',
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, code)
);

-- 3. PIANO DEI CONTI
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  macro_group TEXT NOT NULL,
  parent_id UUID,
  is_fixed BOOLEAN DEFAULT false,
  is_recurring BOOLEAN DEFAULT true,
  default_centers TEXT[] DEFAULT '{all}',
  annual_amount NUMERIC(14,2) DEFAULT 0,
  note TEXT,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, code)
);

-- 4. APP USERS
CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  auth_user_id UUID,
  nome TEXT NOT NULL,
  cognome TEXT NOT NULL,
  email TEXT NOT NULL,
  ruolo TEXT NOT NULL DEFAULT 'operatrice',
  is_active BOOLEAN DEFAULT true,
  outlet_access TEXT[] DEFAULT '{all}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, email)
);

-- 5. BUDGET ENTRIES
CREATE TABLE IF NOT EXISTS budget_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  macro_group TEXT NOT NULL,
  cost_center TEXT NOT NULL DEFAULT 'all',
  year INT NOT NULL,
  month INT NOT NULL CHECK (month >= 1 AND month <= 12),
  budget_amount NUMERIC(14,2) DEFAULT 0,
  actual_amount NUMERIC(14,2),
  is_approved BOOLEAN DEFAULT false,
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, account_code, cost_center, year, month)
);

-- 6. BALANCE SHEET IMPORTS
CREATE TABLE IF NOT EXISTS balance_sheet_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  year INT NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'annuale',
  period_label TEXT,
  file_name TEXT,
  file_path TEXT,
  file_size BIGINT,
  status TEXT DEFAULT 'uploaded',
  extracted_data JSONB,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  verified_at TIMESTAMPTZ,
  verified_by UUID,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. BALANCE SHEET DATA
CREATE TABLE IF NOT EXISTS balance_sheet_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  import_id UUID,
  year INT NOT NULL,
  period_type TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT 'conto_economico',
  account_code TEXT,
  account_name TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  parent_account TEXT,
  cost_center TEXT DEFAULT 'all',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. FORNITORI
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  ragione_sociale TEXT NOT NULL,
  partita_iva TEXT,
  codice_fiscale TEXT,
  codice_sdi TEXT,
  pec TEXT,
  indirizzo TEXT,
  citta TEXT,
  provincia TEXT,
  cap TEXT,
  telefono TEXT,
  email TEXT,
  iban TEXT,
  payment_terms INT DEFAULT 30,
  payment_method TEXT DEFAULT 'bonifico',
  category TEXT,
  cost_center TEXT DEFAULT 'all',
  is_active BOOLEAN DEFAULT true,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 9. FATTURE
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  supplier_id UUID,
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) DEFAULT 0,
  net_amount NUMERIC(14,2) DEFAULT 0,
  currency TEXT DEFAULT 'EUR',
  payment_method TEXT,
  payment_terms TEXT,
  status TEXT DEFAULT 'da_pagare',
  account_code TEXT,
  cost_center TEXT DEFAULT 'all',
  sdi_id TEXT,
  xml_file_path TEXT,
  pdf_file_path TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 10. SCADENZE PAGAMENTO
CREATE TABLE IF NOT EXISTS payment_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  invoice_id UUID,
  installment_number INT DEFAULT 1,
  due_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  payment_method TEXT,
  status TEXT DEFAULT 'pending',
  paid_amount NUMERIC(14,2) DEFAULT 0,
  paid_date DATE,
  bank_account_id UUID,
  bank_reference TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 11. CONTI BANCARI
CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  bank_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  iban TEXT,
  account_type TEXT DEFAULT 'conto_corrente',
  currency TEXT DEFAULT 'EUR',
  current_balance NUMERIC(14,2) DEFAULT 0,
  last_update TIMESTAMPTZ,
  outlet_code TEXT,
  is_active BOOLEAN DEFAULT true,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 12. IMPORT FILE BANCARI (prima di bank_transactions per FK)
CREATE TABLE IF NOT EXISTS bank_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  bank_account_id UUID,
  file_name TEXT NOT NULL,
  file_path TEXT,
  file_size BIGINT,
  file_format TEXT,
  import_type TEXT DEFAULT 'estratto_conto',
  period_from DATE,
  period_to DATE,
  records_count INT DEFAULT 0,
  status TEXT DEFAULT 'uploaded',
  error_message TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 13. MOVIMENTI BANCARI
CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  bank_account_id UUID,
  import_id UUID,
  transaction_date DATE NOT NULL,
  value_date DATE,
  amount NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2),
  description TEXT,
  counterpart TEXT,
  reference TEXT,
  category TEXT,
  supplier_id UUID,
  invoice_id UUID,
  payment_schedule_id UUID,
  is_reconciled BOOLEAN DEFAULT false,
  reconciled_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 14. FINANZIAMENTI
CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  lender TEXT NOT NULL,
  loan_type TEXT NOT NULL DEFAULT 'altro',
  original_amount NUMERIC(14,2) NOT NULL,
  remaining_amount NUMERIC(14,2) NOT NULL,
  interest_rate NUMERIC(5,3) NOT NULL,
  start_date DATE,
  end_date DATE,
  installment_amount NUMERIC(14,2),
  installment_frequency TEXT DEFAULT 'mensile',
  bank_account_id UUID,
  beneficiaries JSONB,
  note TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 15. DIPENDENTI
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  nome TEXT NOT NULL,
  cognome TEXT NOT NULL,
  codice_fiscale TEXT,
  matricola TEXT,
  data_assunzione DATE,
  data_cessazione DATE,
  contratto_tipo TEXT,
  livello TEXT,
  ore_settimanali NUMERIC(5,1) DEFAULT 40,
  is_active BOOLEAN DEFAULT true,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 16. ALLOCAZIONE DIPENDENTI A OUTLET
CREATE TABLE IF NOT EXISTS employee_outlet_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL,
  outlet_code TEXT NOT NULL,
  allocation_pct NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  role_at_outlet TEXT,
  is_primary BOOLEAN DEFAULT true,
  valid_from DATE DEFAULT CURRENT_DATE,
  valid_to DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 17. COSTI DIPENDENTI
CREATE TABLE IF NOT EXISTS employee_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  employee_id UUID,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month >= 1 AND month <= 12),
  retribuzione NUMERIC(12,2) DEFAULT 0,
  contributi NUMERIC(12,2) DEFAULT 0,
  inail NUMERIC(12,2) DEFAULT 0,
  tfr NUMERIC(12,2) DEFAULT 0,
  altri_costi NUMERIC(12,2) DEFAULT 0,
  source TEXT DEFAULT 'manuale',
  import_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, year, month)
);

-- 18. DOCUMENTI DIPENDENTI
CREATE TABLE IF NOT EXISTS employee_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  employee_id UUID,
  doc_type TEXT NOT NULL DEFAULT 'altro',
  year INT,
  month INT,
  file_name TEXT NOT NULL,
  file_path TEXT,
  file_size BIGINT,
  status TEXT DEFAULT 'uploaded',
  extracted_data JSONB,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 19. POSIZIONE DI CASSA
CREATE TABLE IF NOT EXISTS cash_position (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  record_date DATE NOT NULL,
  bank_account_id UUID,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  source TEXT DEFAULT 'manual',
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 20. DOCUMENTI GENERALI
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  category TEXT NOT NULL DEFAULT 'altro',
  reference_type TEXT,
  reference_id UUID,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  file_type TEXT,
  description TEXT,
  year INT,
  month INT,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 21. CONTRACT DOCUMENTS (già creata in precedenza, ricreo IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS contract_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  contract_id UUID,
  file_name TEXT NOT NULL,
  file_path TEXT,
  file_size BIGINT,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 22. IMPORT DOCUMENTS (già creata in precedenza, ricreo IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS import_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  file_name TEXT NOT NULL,
  file_path TEXT,
  file_size BIGINT,
  file_type TEXT,
  source TEXT DEFAULT 'manuale',
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);


-- ========================================
-- PARTE 2: AGGIUNGI COLONNE MANCANTI
-- (per tabelle già esistenti da migrazioni precedenti)
-- ========================================
DO $$
DECLARE
  col_exists BOOLEAN;
BEGIN
  -- Helper: controlla e aggiungi colonna
  -- SUPPLIERS
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'suppliers') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='ragione_sociale') THEN
      ALTER TABLE suppliers ADD COLUMN ragione_sociale TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='partita_iva') THEN
      ALTER TABLE suppliers ADD COLUMN partita_iva TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='codice_fiscale') THEN
      ALTER TABLE suppliers ADD COLUMN codice_fiscale TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='codice_sdi') THEN
      ALTER TABLE suppliers ADD COLUMN codice_sdi TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='pec') THEN
      ALTER TABLE suppliers ADD COLUMN pec TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='indirizzo') THEN
      ALTER TABLE suppliers ADD COLUMN indirizzo TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='citta') THEN
      ALTER TABLE suppliers ADD COLUMN citta TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='provincia') THEN
      ALTER TABLE suppliers ADD COLUMN provincia TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='cap') THEN
      ALTER TABLE suppliers ADD COLUMN cap TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='telefono') THEN
      ALTER TABLE suppliers ADD COLUMN telefono TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='email') THEN
      ALTER TABLE suppliers ADD COLUMN email TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='iban') THEN
      ALTER TABLE suppliers ADD COLUMN iban TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='payment_terms') THEN
      ALTER TABLE suppliers ADD COLUMN payment_terms INT DEFAULT 30; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='payment_method') THEN
      ALTER TABLE suppliers ADD COLUMN payment_method TEXT DEFAULT 'bonifico'; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='category') THEN
      ALTER TABLE suppliers ADD COLUMN category TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='cost_center') THEN
      ALTER TABLE suppliers ADD COLUMN cost_center TEXT DEFAULT 'all'; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='is_active') THEN
      ALTER TABLE suppliers ADD COLUMN is_active BOOLEAN DEFAULT true; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='note') THEN
      ALTER TABLE suppliers ADD COLUMN note TEXT; END IF;
  END IF;

  -- INVOICES
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invoices') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='account_code') THEN
      ALTER TABLE invoices ADD COLUMN account_code TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='cost_center') THEN
      ALTER TABLE invoices ADD COLUMN cost_center TEXT DEFAULT 'all'; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='supplier_id') THEN
      ALTER TABLE invoices ADD COLUMN supplier_id UUID; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='sdi_id') THEN
      ALTER TABLE invoices ADD COLUMN sdi_id TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='xml_file_path') THEN
      ALTER TABLE invoices ADD COLUMN xml_file_path TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='pdf_file_path') THEN
      ALTER TABLE invoices ADD COLUMN pdf_file_path TEXT; END IF;
  END IF;

  -- BANK_ACCOUNTS
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bank_accounts') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bank_accounts' AND column_name='outlet_code') THEN
      ALTER TABLE bank_accounts ADD COLUMN outlet_code TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bank_accounts' AND column_name='last_update') THEN
      ALTER TABLE bank_accounts ADD COLUMN last_update TIMESTAMPTZ; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bank_accounts' AND column_name='account_type') THEN
      ALTER TABLE bank_accounts ADD COLUMN account_type TEXT DEFAULT 'conto_corrente'; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bank_accounts' AND column_name='is_active') THEN
      ALTER TABLE bank_accounts ADD COLUMN is_active BOOLEAN DEFAULT true; END IF;
  END IF;

  -- PAYMENT_SCHEDULE
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_schedule') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_schedule' AND column_name='bank_account_id') THEN
      ALTER TABLE payment_schedule ADD COLUMN bank_account_id UUID; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_schedule' AND column_name='bank_reference') THEN
      ALTER TABLE payment_schedule ADD COLUMN bank_reference TEXT; END IF;
  END IF;

  -- EMPLOYEE_COSTS - aggiungi totale_costo se non c'è (non generated, calcolato lato app)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee_costs') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employee_costs' AND column_name='altri_costi') THEN
      ALTER TABLE employee_costs ADD COLUMN altri_costi NUMERIC(12,2) DEFAULT 0; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employee_costs' AND column_name='source') THEN
      ALTER TABLE employee_costs ADD COLUMN source TEXT DEFAULT 'manuale'; END IF;
  END IF;

  -- BALANCE_SHEET_DATA
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'balance_sheet_data') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='balance_sheet_data' AND column_name='cost_center') THEN
      ALTER TABLE balance_sheet_data ADD COLUMN cost_center TEXT DEFAULT 'all'; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='balance_sheet_data' AND column_name='parent_account') THEN
      ALTER TABLE balance_sheet_data ADD COLUMN parent_account TEXT; END IF;
  END IF;

  -- IMPORT_DOCUMENTS - colonne aggiuntive
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'import_documents') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_documents' AND column_name='source') THEN
      ALTER TABLE import_documents ADD COLUMN source TEXT DEFAULT 'manuale'; END IF;
  END IF;

END $$;


-- ========================================
-- PARTE 3: INDICI
-- ========================================
CREATE INDEX IF NOT EXISTS idx_budget_year_month ON budget_entries(year, month);
CREATE INDEX IF NOT EXISTS idx_budget_account ON budget_entries(account_code);
CREATE INDEX IF NOT EXISTS idx_budget_center ON budget_entries(cost_center);
CREATE INDEX IF NOT EXISTS idx_bs_data_year ON balance_sheet_data(year, period_type);
CREATE INDEX IF NOT EXISTS idx_bs_data_section ON balance_sheet_data(section);
CREATE INDEX IF NOT EXISTS idx_suppliers_piva ON suppliers(partita_iva);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier ON invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_payments_due ON payment_schedule(due_date);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payment_schedule(status);
CREATE INDEX IF NOT EXISTS idx_bank_tx_date ON bank_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_bank_tx_account ON bank_transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_tx_reconciled ON bank_transactions(is_reconciled);
CREATE INDEX IF NOT EXISTS idx_emp_alloc_employee ON employee_outlet_allocations(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_alloc_outlet ON employee_outlet_allocations(outlet_code);
CREATE INDEX IF NOT EXISTS idx_emp_costs_period ON employee_costs(year, month);
CREATE INDEX IF NOT EXISTS idx_emp_costs_employee ON employee_costs(employee_id);
CREATE INDEX IF NOT EXISTS idx_docs_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_docs_ref ON documents(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_contract_documents_contract ON contract_documents(contract_id);


-- ========================================
-- PARTE 4: RLS POLICIES (ignora se già esistono)
-- ========================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'company_settings', 'cost_centers', 'chart_of_accounts', 'app_users',
    'budget_entries', 'balance_sheet_imports', 'balance_sheet_data',
    'suppliers', 'invoices', 'payment_schedule', 'bank_accounts',
    'bank_imports', 'bank_transactions', 'loans', 'employees',
    'employee_outlet_allocations', 'employee_costs', 'employee_documents',
    'cash_position', 'documents', 'contract_documents', 'import_documents'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    BEGIN
      EXECUTE format('CREATE POLICY "auth_select_%1$s" ON %1$I FOR SELECT TO authenticated USING (true)', tbl);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      EXECUTE format('CREATE POLICY "auth_insert_%1$s" ON %1$I FOR INSERT TO authenticated WITH CHECK (true)', tbl);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      EXECUTE format('CREATE POLICY "auth_update_%1$s" ON %1$I FOR UPDATE TO authenticated USING (true)', tbl);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      EXECUTE format('CREATE POLICY "auth_delete_%1$s" ON %1$I FOR DELETE TO authenticated USING (true)', tbl);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;


-- ========================================
-- PARTE 5: STORAGE BUCKETS
-- ========================================
INSERT INTO storage.buckets (id, name, public) VALUES
  ('contract-documents', 'contract-documents', false),
  ('balance-sheets', 'balance-sheets', false),
  ('bank-statements', 'bank-statements', false),
  ('employee-documents', 'employee-documents', false),
  ('invoices', 'invoices', false),
  ('general-documents', 'general-documents', false),
  ('outlet-attachments', 'outlet-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies per tutti i bucket
DO $$
DECLARE
  bname TEXT;
BEGIN
  FOREACH bname IN ARRAY ARRAY[
    'contract-documents', 'balance-sheets', 'bank-statements',
    'employee-documents', 'invoices', 'general-documents', 'outlet-attachments'
  ]
  LOOP
    BEGIN
      EXECUTE format('CREATE POLICY "auth_read_%1$s" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = %2$L)', replace(bname, '-', '_'), bname);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      EXECUTE format('CREATE POLICY "auth_write_%1$s" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = %2$L)', replace(bname, '-', '_'), bname);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      EXECUTE format('CREATE POLICY "auth_del_%1$s" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = %2$L)', replace(bname, '-', '_'), bname);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;


-- ========================================
-- PARTE 6: VISTE (DROP + RECREATE)
-- ========================================
DROP VIEW IF EXISTS v_payment_schedule CASCADE;
DROP VIEW IF EXISTS v_employee_costs_by_outlet CASCADE;
DROP VIEW IF EXISTS v_budget_variance CASCADE;
DROP VIEW IF EXISTS v_profit_and_loss CASCADE;

CREATE VIEW v_payment_schedule AS
SELECT
  ps.*,
  i.invoice_number,
  i.invoice_date,
  i.total_amount AS invoice_total,
  i.account_code,
  i.cost_center,
  s.ragione_sociale AS supplier_name,
  s.partita_iva AS supplier_piva,
  ba.bank_name,
  ba.account_name
FROM payment_schedule ps
LEFT JOIN invoices i ON ps.invoice_id = i.id
LEFT JOIN suppliers s ON i.supplier_id = s.id
LEFT JOIN bank_accounts ba ON ps.bank_account_id = ba.id;

CREATE VIEW v_employee_costs_by_outlet AS
SELECT
  ec.year,
  ec.month,
  eoa.outlet_code,
  e.id AS employee_id,
  e.nome || ' ' || e.cognome AS employee_name,
  eoa.role_at_outlet,
  eoa.allocation_pct,
  ROUND(ec.retribuzione * eoa.allocation_pct / 100, 2) AS retribuzione_allocata,
  ROUND(ec.contributi * eoa.allocation_pct / 100, 2) AS contributi_allocati,
  ROUND(ec.inail * eoa.allocation_pct / 100, 2) AS inail_allocato,
  ROUND(ec.tfr * eoa.allocation_pct / 100, 2) AS tfr_allocato,
  ROUND((ec.retribuzione + ec.contributi + ec.inail + ec.tfr + ec.altri_costi) * eoa.allocation_pct / 100, 2) AS totale_allocato
FROM employee_costs ec
JOIN employees e ON ec.employee_id = e.id
JOIN employee_outlet_allocations eoa ON e.id = eoa.employee_id
  AND (eoa.valid_to IS NULL OR eoa.valid_to >= make_date(ec.year, ec.month, 1));

CREATE VIEW v_budget_variance AS
SELECT
  be.*,
  COALESCE(be.actual_amount, 0) - COALESCE(be.budget_amount, 0) AS variance,
  CASE WHEN be.budget_amount != 0
    THEN ROUND(((COALESCE(be.actual_amount, 0) - be.budget_amount) / be.budget_amount * 100)::numeric, 1)
    ELSE 0
  END AS variance_pct
FROM budget_entries be;

CREATE VIEW v_profit_and_loss AS
SELECT
  bsd.year,
  bsd.period_type,
  bsd.account_name,
  bsd.account_code,
  bsd.parent_account,
  bsd.cost_center,
  SUM(bsd.amount) AS total_amount,
  bsd.sort_order
FROM balance_sheet_data bsd
WHERE bsd.section = 'conto_economico'
GROUP BY bsd.year, bsd.period_type, bsd.account_name, bsd.account_code, bsd.parent_account, bsd.cost_center, bsd.sort_order
ORDER BY bsd.sort_order;


-- ========================================
-- PARTE 7: SEED DATA INIZIALI
-- ========================================

-- Centri di costo
INSERT INTO cost_centers (company_id, code, label, color, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000001', 'sede_magazzino', 'Ufficio/Magazzino Figline', 'bg-amber-600', 0),
  ('00000000-0000-0000-0000-000000000001', 'valdichiana', 'Valdichiana Village (VDC)', 'bg-blue-600', 1),
  ('00000000-0000-0000-0000-000000000001', 'barberino', 'Barberino McArthurGlen (BRB)', 'bg-emerald-600', 2),
  ('00000000-0000-0000-0000-000000000001', 'palmanova', 'Palmanova Outlet (PLM)', 'bg-sky-600', 3),
  ('00000000-0000-0000-0000-000000000001', 'franciacorta', 'Franciacorta Village (FRC)', 'bg-rose-600', 4),
  ('00000000-0000-0000-0000-000000000001', 'brugnato', 'Brugnato 5Terre (BRG)', 'bg-orange-600', 5),
  ('00000000-0000-0000-0000-000000000001', 'valmontone', 'Valmontone Outlet (VLM)', 'bg-purple-600', 6),
  ('00000000-0000-0000-0000-000000000001', 'torino', 'Torino Outlet Village (TRN)', 'bg-indigo-600', 7)
ON CONFLICT (company_id, code) DO NOTHING;

-- Piano dei conti
INSERT INTO chart_of_accounts (company_id, code, name, macro_group, is_fixed, is_recurring, default_centers, annual_amount, note, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000001', 'MRC001', 'Acquisto merci', 'Costo del venduto', false, true, '{all}', 1252803, 'Incidenza ~54% su ricavi', 1),
  ('00000000-0000-0000-0000-000000000001', 'MRC002', 'Trasporti e logistica', 'Costo del venduto', false, true, '{sede_magazzino}', 28500, '', 2),
  ('00000000-0000-0000-0000-000000000001', 'LOC001', 'Affitti outlet', 'Locazione', true, true, '{valdichiana,barberino,palmanova,franciacorta,brugnato,valmontone,torino}', 309600, '', 3),
  ('00000000-0000-0000-0000-000000000001', 'LOC002', 'Affitto sede/magazzino', 'Locazione', true, true, '{sede_magazzino}', 36000, '', 4),
  ('00000000-0000-0000-0000-000000000001', 'PER001', 'Stipendi dipendenti', 'Personale', true, true, '{all}', 451314, '', 5),
  ('00000000-0000-0000-0000-000000000001', 'PER002', 'Oneri sociali', 'Personale', true, true, '{all}', 138547, '', 6),
  ('00000000-0000-0000-0000-000000000001', 'PER003', 'TFR', 'Personale', true, true, '{all}', 26134, '', 7),
  ('00000000-0000-0000-0000-000000000001', 'PER004', 'Emolumenti amministratore', 'Personale', true, true, '{sede_magazzino}', 119488, '', 8),
  ('00000000-0000-0000-0000-000000000001', 'GAM001', 'Commercialista', 'Generali & Amministrative', true, true, '{sede_magazzino}', 24000, '', 9),
  ('00000000-0000-0000-0000-000000000001', 'GAM002', 'Consulente lavoro', 'Generali & Amministrative', true, true, '{sede_magazzino}', 12000, '', 10),
  ('00000000-0000-0000-0000-000000000001', 'GAM003', 'Assicurazioni', 'Generali & Amministrative', true, true, '{all}', 18500, '', 11),
  ('00000000-0000-0000-0000-000000000001', 'GAM004', 'Software e licenze', 'Generali & Amministrative', true, true, '{sede_magazzino}', 8400, '', 12),
  ('00000000-0000-0000-0000-000000000001', 'FIN001', 'Interessi finanziamento MPS', 'Finanziarie', true, true, '{sede_magazzino}', 2636, 'Tasso 4.0%', 13),
  ('00000000-0000-0000-0000-000000000001', 'FIN002', 'Interessi prestito soci', 'Finanziarie', true, true, '{sede_magazzino}', 26250, 'Tasso 3.5% su 750k', 14),
  ('00000000-0000-0000-0000-000000000001', 'FIN003', 'Commissioni bancarie', 'Finanziarie', false, true, '{all}', 4800, '', 15),
  ('00000000-0000-0000-0000-000000000001', 'UTS001', 'Energia elettrica', 'Utenze & Servizi', false, true, '{all}', 42000, '', 16),
  ('00000000-0000-0000-0000-000000000001', 'UTS002', 'Telefonia e internet', 'Utenze & Servizi', true, true, '{all}', 9600, '', 17),
  ('00000000-0000-0000-0000-000000000001', 'MKT001', 'Marketing e pubblicità', 'Marketing', false, true, '{all}', 24000, '', 18),
  ('00000000-0000-0000-0000-000000000001', 'MAN001', 'Manutenzioni ordinarie', 'Manutenzione', false, true, '{all}', 15000, '', 19),
  ('00000000-0000-0000-0000-000000000001', 'OND001', 'Oneri diversi di gestione', 'Oneri diversi', false, false, '{sede_magazzino}', 8500, '', 20)
ON CONFLICT (company_id, code) DO NOTHING;

-- Conti bancari (solo se non ci sono già dati)
INSERT INTO bank_accounts (company_id, bank_name, account_name, iban, account_type, current_balance, note)
SELECT '00000000-0000-0000-0000-000000000001', 'MPS', 'C/C Principale MPS', 'IT00X0000000000000000000001', 'conto_corrente', 286345.12, 'Conto operativo principale'
WHERE NOT EXISTS (SELECT 1 FROM bank_accounts WHERE company_id = '00000000-0000-0000-0000-000000000001' AND bank_name = 'MPS' AND account_name = 'C/C Principale MPS');

INSERT INTO bank_accounts (company_id, bank_name, account_name, iban, account_type, current_balance, note)
SELECT '00000000-0000-0000-0000-000000000001', 'MPS', 'C/C POS MPS', 'IT00X0000000000000000000002', 'pos', 45678.90, 'Incassi POS'
WHERE NOT EXISTS (SELECT 1 FROM bank_accounts WHERE company_id = '00000000-0000-0000-0000-000000000001' AND account_name = 'C/C POS MPS');

INSERT INTO bank_accounts (company_id, bank_name, account_name, iban, account_type, current_balance, note)
SELECT '00000000-0000-0000-0000-000000000001', 'BCC', 'C/C BCC Chianti', 'IT00X0000000000000000000003', 'conto_corrente', 52450.00, ''
WHERE NOT EXISTS (SELECT 1 FROM bank_accounts WHERE company_id = '00000000-0000-0000-0000-000000000001' AND bank_name = 'BCC');

INSERT INTO bank_accounts (company_id, bank_name, account_name, iban, account_type, current_balance, note)
SELECT '00000000-0000-0000-0000-000000000001', 'Banco Fiorentino', 'C/C Banco Fiorentino', 'IT00X0000000000000000000004', 'conto_corrente', 23987.50, ''
WHERE NOT EXISTS (SELECT 1 FROM bank_accounts WHERE company_id = '00000000-0000-0000-0000-000000000001' AND bank_name = 'Banco Fiorentino');

-- Finanziamenti (solo se non ci sono già)
INSERT INTO loans (company_id, lender, loan_type, original_amount, remaining_amount, interest_rate, note, beneficiaries)
SELECT '00000000-0000-0000-0000-000000000001', 'MPS', 'bancario_breve', 65900, 65900, 4.000, 'Finanziamento breve termine', NULL
WHERE NOT EXISTS (SELECT 1 FROM loans WHERE company_id = '00000000-0000-0000-0000-000000000001' AND lender = 'MPS');

INSERT INTO loans (company_id, lender, loan_type, original_amount, remaining_amount, interest_rate, note, beneficiaries)
SELECT '00000000-0000-0000-0000-000000000001', 'Soci', 'soci', 750000, 750000, 3.500, 'Prestito soci', '[{"nome":"AMERICAN T-SHIRT S.R.L.","quota_pct":55},{"nome":"PAMA S.R.L.","quota_pct":45}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM loans WHERE company_id = '00000000-0000-0000-0000-000000000001' AND lender = 'Soci');

-- Dati azienda
INSERT INTO company_settings (company_id, ragione_sociale, forma_giuridica, sede_legale, partita_iva, codice_fiscale, rea, capitale_sociale, data_costituzione, pec, codice_sdi, ateco, amministratore, note, soci)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'NEW ZAGO S.R.L.',
  'Società a responsabilità limitata',
  'Via Chiantigiana 103, 50012 Bagno a Ripoli (FI)',
  '07XXXXXXXXX',
  '07XXXXXXXXX',
  'FI-XXXXXX',
  '€ 10.000,00 i.v.',
  '2024',
  'newzago@pec.it',
  'XXXXXXX',
  '47.71.10 – Commercio al dettaglio di abbigliamento',
  'Ferretti Fabio (Amministratore Unico)',
  'Catena di outlet moda – 7 punti vendita attivi in Italia',
  '[{"nome":"AMERICAN T-SHIRT S.R.L.","quota":"55%","ruolo":"Socio di maggioranza"},{"nome":"PAMA S.R.L.","quota":"45%","ruolo":"Socio"}]'::jsonb
) ON CONFLICT (company_id) DO NOTHING;


-- ========================================
-- FATTO!
-- ========================================
SELECT 'Schema Gestionale NZ creato con successo! ' ||
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') ||
       ' tabelle totali.' AS risultato;
