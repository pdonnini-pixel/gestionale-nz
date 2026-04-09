-- ============================================================
-- GESTIONALE NEW ZAGO - SCHEMA DATABASE COMPLETO
-- Eseguire in Supabase SQL Editor
-- ============================================================

-- ========================
-- 1. DATI AZIENDA
-- ========================
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

ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read company" ON company_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated update company" ON company_settings FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated insert company" ON company_settings FOR INSERT TO authenticated WITH CHECK (true);

-- ========================
-- 2. CENTRI DI COSTO
-- ========================
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

ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read cost_centers" ON cost_centers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert cost_centers" ON cost_centers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update cost_centers" ON cost_centers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete cost_centers" ON cost_centers FOR DELETE TO authenticated USING (true);

-- Seed centri di costo iniziali
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

-- ========================
-- 3. PIANO DEI CONTI (Chart of Accounts)
-- ========================
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  macro_group TEXT NOT NULL,
  parent_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
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

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read coa" ON chart_of_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert coa" ON chart_of_accounts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update coa" ON chart_of_accounts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete coa" ON chart_of_accounts FOR DELETE TO authenticated USING (true);

-- Seed piano dei conti iniziale (da bilancio 2024/2025)
INSERT INTO chart_of_accounts (company_id, code, name, macro_group, is_fixed, is_recurring, default_centers, annual_amount, note, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000001', 'MRC001', 'Acquisto merci', 'Costo del venduto', false, true, '{all}', 1252803, 'Incidenza ~54% su ricavi', 1),
  ('00000000-0000-0000-0000-000000000001', 'MRC002', 'Trasporti e logistica', 'Costo del venduto', false, true, '{sede_magazzino}', 28500, '', 2),
  ('00000000-0000-0000-0000-000000000001', 'LOC001', 'Affitti outlet', 'Locazione', true, true, '{valdichiana,barberino,palmanova,franciacorta,brugnato,valmontone,torino}', 309600, 'Affitti variabili per outlet', 3),
  ('00000000-0000-0000-0000-000000000001', 'LOC002', 'Affitto sede/magazzino', 'Locazione', true, true, '{sede_magazzino}', 36000, '', 4),
  ('00000000-0000-0000-0000-000000000001', 'PER001', 'Stipendi dipendenti', 'Personale', true, true, '{all}', 451314, '35 dipendenti', 5),
  ('00000000-0000-0000-0000-000000000001', 'PER002', 'Oneri sociali', 'Personale', true, true, '{all}', 138547, '', 6),
  ('00000000-0000-0000-0000-000000000001', 'PER003', 'TFR', 'Personale', true, true, '{all}', 26134, '', 7),
  ('00000000-0000-0000-0000-000000000001', 'PER004', 'Emolumenti amministratore', 'Personale', true, true, '{sede_magazzino}', 119488, '', 8),
  ('00000000-0000-0000-0000-000000000001', 'GAM001', 'Commercialista', 'Generali & Amministrative', true, true, '{sede_magazzino}', 24000, '', 9),
  ('00000000-0000-0000-0000-000000000001', 'GAM002', 'Consulente lavoro', 'Generali & Amministrative', true, true, '{sede_magazzino}', 12000, '', 10),
  ('00000000-0000-0000-0000-000000000001', 'GAM003', 'Assicurazioni', 'Generali & Amministrative', true, true, '{all}', 18500, '', 11),
  ('00000000-0000-0000-0000-000000000001', 'GAM004', 'Software e licenze', 'Generali & Amministrative', true, true, '{sede_magazzino}', 8400, 'POS, gestionale, contabilità', 12),
  ('00000000-0000-0000-0000-000000000001', 'FIN001', 'Interessi finanziamento MPS', 'Finanziarie', true, true, '{sede_magazzino}', 2636, 'Tasso 4.0%', 13),
  ('00000000-0000-0000-0000-000000000001', 'FIN002', 'Interessi prestito soci', 'Finanziarie', true, true, '{sede_magazzino}', 26250, 'Tasso 3.5% su 750k', 14),
  ('00000000-0000-0000-0000-000000000001', 'FIN003', 'Commissioni bancarie', 'Finanziarie', false, true, '{all}', 4800, '', 15),
  ('00000000-0000-0000-0000-000000000001', 'UTS001', 'Energia elettrica', 'Utenze & Servizi', false, true, '{all}', 42000, '', 16),
  ('00000000-0000-0000-0000-000000000001', 'UTS002', 'Telefonia e internet', 'Utenze & Servizi', true, true, '{all}', 9600, '', 17),
  ('00000000-0000-0000-0000-000000000001', 'MKT001', 'Marketing e pubblicità', 'Marketing', false, true, '{all}', 24000, '', 18),
  ('00000000-0000-0000-0000-000000000001', 'MAN001', 'Manutenzioni ordinarie', 'Manutenzione', false, true, '{all}', 15000, '', 19),
  ('00000000-0000-0000-0000-000000000001', 'OND001', 'Oneri diversi di gestione', 'Oneri diversi', false, false, '{sede_magazzino}', 8500, '', 20)
ON CONFLICT (company_id, code) DO NOTHING;

-- ========================
-- 4. APP USERS (gestione utenti nel gestionale)
-- ========================
CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
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

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read app_users" ON app_users FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert app_users" ON app_users FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update app_users" ON app_users FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete app_users" ON app_users FOR DELETE TO authenticated USING (true);

-- ========================
-- 5. BUDGET ENTRIES (preventivo + consuntivo mensile)
-- ========================
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

ALTER TABLE budget_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read budget" ON budget_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert budget" ON budget_entries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update budget" ON budget_entries FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete budget" ON budget_entries FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_budget_year_month ON budget_entries(year, month);
CREATE INDEX idx_budget_account ON budget_entries(account_code);
CREATE INDEX idx_budget_center ON budget_entries(cost_center);

-- ========================
-- 6. BALANCE SHEET IMPORTS (bilanci caricati)
-- ========================
CREATE TABLE IF NOT EXISTS balance_sheet_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  year INT NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('annuale', 'trimestrale', 'mensile', 'provvisorio')),
  period_label TEXT, -- es "Q1 2025", "Marzo 2025", "Bilancio 2024"
  file_name TEXT,
  file_path TEXT,
  file_size BIGINT,
  status TEXT DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsed', 'verified', 'approved')),
  extracted_data JSONB, -- dati estratti dal PDF
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  verified_at TIMESTAMPTZ,
  verified_by UUID,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE balance_sheet_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read bs_imports" ON balance_sheet_imports FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert bs_imports" ON balance_sheet_imports FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update bs_imports" ON balance_sheet_imports FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete bs_imports" ON balance_sheet_imports FOR DELETE TO authenticated USING (true);

-- ========================
-- 7. BALANCE SHEET DATA (dati bilancio per voce)
-- ========================
CREATE TABLE IF NOT EXISTS balance_sheet_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  import_id UUID REFERENCES balance_sheet_imports(id) ON DELETE CASCADE,
  year INT NOT NULL,
  period_type TEXT NOT NULL,
  section TEXT NOT NULL CHECK (section IN ('conto_economico', 'stato_patrimoniale_attivo', 'stato_patrimoniale_passivo', 'nota_integrativa')),
  account_code TEXT,
  account_name TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  parent_account TEXT,
  cost_center TEXT DEFAULT 'all',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE balance_sheet_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read bs_data" ON balance_sheet_data FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert bs_data" ON balance_sheet_data FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update bs_data" ON balance_sheet_data FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete bs_data" ON balance_sheet_data FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_bs_data_year ON balance_sheet_data(year, period_type);
CREATE INDEX idx_bs_data_section ON balance_sheet_data(section);

-- ========================
-- 8. FORNITORI (anagrafica)
-- ========================
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
  payment_terms INT DEFAULT 30, -- giorni
  payment_method TEXT DEFAULT 'bonifico',
  category TEXT, -- merci, servizi, affitti, utenze, etc.
  cost_center TEXT DEFAULT 'all',
  is_active BOOLEAN DEFAULT true,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read suppliers" ON suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert suppliers" ON suppliers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update suppliers" ON suppliers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete suppliers" ON suppliers FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_suppliers_piva ON suppliers(partita_iva);

-- ========================
-- 9. FATTURE (invoices)
-- ========================
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) DEFAULT 0,
  net_amount NUMERIC(14,2) DEFAULT 0,
  currency TEXT DEFAULT 'EUR',
  payment_method TEXT,
  payment_terms TEXT,
  status TEXT DEFAULT 'da_pagare' CHECK (status IN ('da_pagare', 'parziale', 'pagata', 'sospesa', 'contestata', 'annullata')),
  account_code TEXT, -- voce piano dei conti
  cost_center TEXT DEFAULT 'all',
  sdi_id TEXT, -- riferimento SDI
  xml_file_path TEXT, -- file XML originale
  pdf_file_path TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read invoices" ON invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert invoices" ON invoices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update invoices" ON invoices FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete invoices" ON invoices FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_invoices_supplier ON invoices(supplier_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_due_date ON invoices(due_date);

-- ========================
-- 10. SCADENZE PAGAMENTO
-- ========================
CREATE TABLE IF NOT EXISTS payment_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  installment_number INT DEFAULT 1,
  due_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  payment_method TEXT, -- bonifico, riba, rid, contanti, assegno
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'partial', 'overdue', 'suspended', 'postponed')),
  paid_amount NUMERIC(14,2) DEFAULT 0,
  paid_date DATE,
  bank_account_id UUID,
  bank_reference TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE payment_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read payments" ON payment_schedule FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert payments" ON payment_schedule FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update payments" ON payment_schedule FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete payments" ON payment_schedule FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_payments_due ON payment_schedule(due_date);
CREATE INDEX idx_payments_status ON payment_schedule(status);

-- ========================
-- 11. CONTI BANCARI
-- ========================
CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  bank_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  iban TEXT,
  account_type TEXT DEFAULT 'conto_corrente' CHECK (account_type IN ('conto_corrente', 'cassa', 'pos', 'deposito', 'finanziamento')),
  currency TEXT DEFAULT 'EUR',
  current_balance NUMERIC(14,2) DEFAULT 0,
  last_update TIMESTAMPTZ,
  outlet_code TEXT, -- collegamento outlet per casse
  is_active BOOLEAN DEFAULT true,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, iban)
);

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read bank_accounts" ON bank_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert bank_accounts" ON bank_accounts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update bank_accounts" ON bank_accounts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete bank_accounts" ON bank_accounts FOR DELETE TO authenticated USING (true);

-- Seed conti bancari iniziali
INSERT INTO bank_accounts (company_id, bank_name, account_name, iban, account_type, current_balance, note) VALUES
  ('00000000-0000-0000-0000-000000000001', 'MPS', 'C/C Principale MPS', 'IT00X0000000000000000000001', 'conto_corrente', 286345.12, 'Conto operativo principale'),
  ('00000000-0000-0000-0000-000000000001', 'MPS', 'C/C POS MPS', 'IT00X0000000000000000000002', 'pos', 45678.90, 'Incassi POS'),
  ('00000000-0000-0000-0000-000000000001', 'BCC', 'C/C BCC Chianti', 'IT00X0000000000000000000003', 'conto_corrente', 52450.00, ''),
  ('00000000-0000-0000-0000-000000000001', 'Banco Fiorentino', 'C/C Banco Fiorentino', 'IT00X0000000000000000000004', 'conto_corrente', 23987.50, '')
ON CONFLICT (company_id, iban) DO NOTHING;

-- ========================
-- 12. IMPORT FILE BANCARI (prima di bank_transactions per FK)
-- ========================
CREATE TABLE IF NOT EXISTS bank_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT,
  file_size BIGINT,
  file_format TEXT, -- csv, xlsx, xls, pdf, cbi, mt940
  import_type TEXT DEFAULT 'estratto_conto' CHECK (import_type IN ('estratto_conto_mensile', 'estratto_conto_trimestrale', 'estratto_conto_annuale', 'estratto_conto', 'estratto_pos', 'lista_movimenti', 'altro')),
  period_from DATE,
  period_to DATE,
  records_count INT DEFAULT 0,
  status TEXT DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsing', 'parsed', 'verified', 'error')),
  error_message TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE bank_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read bank_imports" ON bank_imports FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert bank_imports" ON bank_imports FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update bank_imports" ON bank_imports FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete bank_imports" ON bank_imports FOR DELETE TO authenticated USING (true);

-- ========================
-- 13. MOVIMENTI BANCARI (dopo bank_imports per FK)
-- ========================
CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE CASCADE,
  import_id UUID REFERENCES bank_imports(id) ON DELETE SET NULL,
  transaction_date DATE NOT NULL,
  value_date DATE,
  amount NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2),
  description TEXT,
  counterpart TEXT,
  reference TEXT,
  category TEXT,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  payment_schedule_id UUID REFERENCES payment_schedule(id) ON DELETE SET NULL,
  is_reconciled BOOLEAN DEFAULT false,
  reconciled_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read bank_tx" ON bank_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert bank_tx" ON bank_transactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update bank_tx" ON bank_transactions FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete bank_tx" ON bank_transactions FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_bank_tx_date ON bank_transactions(transaction_date);
CREATE INDEX idx_bank_tx_account ON bank_transactions(bank_account_id);
CREATE INDEX idx_bank_tx_reconciled ON bank_transactions(is_reconciled);

-- ========================
-- 14. FINANZIAMENTI
-- ========================
CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  lender TEXT NOT NULL, -- MPS, Soci, etc.
  loan_type TEXT NOT NULL CHECK (loan_type IN ('bancario_breve', 'bancario_lungo', 'soci', 'altro')),
  original_amount NUMERIC(14,2) NOT NULL,
  remaining_amount NUMERIC(14,2) NOT NULL,
  interest_rate NUMERIC(5,3) NOT NULL, -- es 3.500
  start_date DATE,
  end_date DATE,
  installment_amount NUMERIC(14,2),
  installment_frequency TEXT DEFAULT 'mensile',
  bank_account_id UUID REFERENCES bank_accounts(id),
  beneficiaries JSONB, -- per prestito soci: [{nome, quota_pct}]
  note TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read loans" ON loans FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert loans" ON loans FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update loans" ON loans FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete loans" ON loans FOR DELETE TO authenticated USING (true);

-- Seed finanziamenti
INSERT INTO loans (company_id, lender, loan_type, original_amount, remaining_amount, interest_rate, note, beneficiaries) VALUES
  ('00000000-0000-0000-0000-000000000001', 'MPS', 'bancario_breve', 65900, 65900, 4.000, 'Finanziamento breve termine', NULL),
  ('00000000-0000-0000-0000-000000000001', 'Soci', 'soci', 750000, 750000, 3.500, 'Prestito soci infruttifero rivalutato', '[{"nome":"AMERICAN T-SHIRT S.R.L.","quota_pct":55},{"nome":"PAMA S.R.L.","quota_pct":45}]'::jsonb)
ON CONFLICT DO NOTHING;

-- ========================
-- 15. DIPENDENTI
-- ========================
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  nome TEXT NOT NULL,
  cognome TEXT NOT NULL,
  codice_fiscale TEXT,
  matricola TEXT,
  data_assunzione DATE,
  data_cessazione DATE,
  contratto_tipo TEXT, -- tempo_indeterminato, determinato, apprendistato, etc.
  livello TEXT, -- livello CCNL
  ore_settimanali NUMERIC(5,1) DEFAULT 40,
  is_active BOOLEAN DEFAULT true,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read employees" ON employees FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert employees" ON employees FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update employees" ON employees FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete employees" ON employees FOR DELETE TO authenticated USING (true);

-- ========================
-- 16. ALLOCAZIONE DIPENDENTI A OUTLET
-- ========================
CREATE TABLE IF NOT EXISTS employee_outlet_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  outlet_code TEXT NOT NULL,
  allocation_pct NUMERIC(5,2) NOT NULL DEFAULT 100.00, -- percentuale di allocazione
  role_at_outlet TEXT, -- responsabile, addetta_vendita, etc.
  is_primary BOOLEAN DEFAULT true,
  valid_from DATE DEFAULT CURRENT_DATE,
  valid_to DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE employee_outlet_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read emp_alloc" ON employee_outlet_allocations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert emp_alloc" ON employee_outlet_allocations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update emp_alloc" ON employee_outlet_allocations FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete emp_alloc" ON employee_outlet_allocations FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_emp_alloc_employee ON employee_outlet_allocations(employee_id);
CREATE INDEX idx_emp_alloc_outlet ON employee_outlet_allocations(outlet_code);

-- ========================
-- 17. COSTI DIPENDENTI (periodi)
-- ========================
CREATE TABLE IF NOT EXISTS employee_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month >= 1 AND month <= 12),
  retribuzione NUMERIC(12,2) DEFAULT 0,
  contributi NUMERIC(12,2) DEFAULT 0,
  inail NUMERIC(12,2) DEFAULT 0,
  tfr NUMERIC(12,2) DEFAULT 0,
  altri_costi NUMERIC(12,2) DEFAULT 0,
  totale_costo NUMERIC(12,2) GENERATED ALWAYS AS (retribuzione + contributi + inail + tfr + altri_costi) STORED,
  source TEXT DEFAULT 'manuale' CHECK (source IN ('manuale', 'cedolino', 'excel_import')),
  import_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, year, month)
);

ALTER TABLE employee_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read emp_costs" ON employee_costs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert emp_costs" ON employee_costs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update emp_costs" ON employee_costs FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete emp_costs" ON employee_costs FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_emp_costs_period ON employee_costs(year, month);
CREATE INDEX idx_emp_costs_employee ON employee_costs(employee_id);

-- ========================
-- 18. DOCUMENTI DIPENDENTI (cedolini, LUL, etc.)
-- ========================
CREATE TABLE IF NOT EXISTS employee_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('cedolino', 'lul', 'riepilogo_excel', 'contratto', 'altro')),
  year INT,
  month INT,
  file_name TEXT NOT NULL,
  file_path TEXT,
  file_size BIGINT,
  status TEXT DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsed', 'verified', 'error')),
  extracted_data JSONB,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read emp_docs" ON employee_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert emp_docs" ON employee_documents FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update emp_docs" ON employee_documents FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete emp_docs" ON employee_documents FOR DELETE TO authenticated USING (true);

-- ========================
-- 19. POSIZIONE DI CASSA
-- ========================
CREATE TABLE IF NOT EXISTS cash_position (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  record_date DATE NOT NULL,
  bank_account_id UUID REFERENCES bank_accounts(id),
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'bank_import', 'calculated')),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, record_date, bank_account_id)
);

ALTER TABLE cash_position ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read cash" ON cash_position FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert cash" ON cash_position FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update cash" ON cash_position FOR UPDATE TO authenticated USING (true);

-- ========================
-- 20. DOCUMENTI GENERALI (storage generico)
-- ========================
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  category TEXT NOT NULL, -- bilancio, contratto, fattura, cedolino, banca, altro
  reference_type TEXT, -- outlet, supplier, employee, invoice
  reference_id UUID,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  file_type TEXT, -- pdf, xlsx, csv, xml, docx
  description TEXT,
  year INT,
  month INT,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read docs" ON documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert docs" ON documents FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update docs" ON documents FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete docs" ON documents FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_docs_category ON documents(category);
CREATE INDEX idx_docs_ref ON documents(reference_type, reference_id);

-- ========================
-- STORAGE BUCKETS
-- ========================
-- Nota: i bucket si creano via dashboard o API, non via SQL standard.
-- Ma possiamo provare con insert diretto nella tabella storage.buckets
INSERT INTO storage.buckets (id, name, public) VALUES
  ('balance-sheets', 'balance-sheets', false),
  ('bank-statements', 'bank-statements', false),
  ('employee-documents', 'employee-documents', false),
  ('invoices', 'invoices', false),
  ('general-documents', 'general-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies per tutti i bucket
DO $$
DECLARE
  bucket_name TEXT;
BEGIN
  FOREACH bucket_name IN ARRAY ARRAY['balance-sheets', 'bank-statements', 'employee-documents', 'invoices', 'general-documents']
  LOOP
    EXECUTE format('CREATE POLICY "Auth read %1$s" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = %2$L)', bucket_name, bucket_name);
    EXECUTE format('CREATE POLICY "Auth insert %1$s" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = %2$L)', bucket_name, bucket_name);
    EXECUTE format('CREATE POLICY "Auth delete %1$s" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = %2$L)', bucket_name, bucket_name);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ========================
-- VISTE UTILI
-- ========================

-- Vista scadenzario con dettagli fornitore
CREATE OR REPLACE VIEW v_payment_schedule AS
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

-- Vista costi dipendenti per outlet
CREATE OR REPLACE VIEW v_employee_costs_by_outlet AS
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
  ROUND(ec.totale_costo * eoa.allocation_pct / 100, 2) AS totale_allocato
FROM employee_costs ec
JOIN employees e ON ec.employee_id = e.id
JOIN employee_outlet_allocations eoa ON e.id = eoa.employee_id
  AND (eoa.valid_to IS NULL OR eoa.valid_to >= make_date(ec.year, ec.month, 1));

-- Vista budget con scostamento
CREATE OR REPLACE VIEW v_budget_variance AS
SELECT
  be.*,
  COALESCE(be.actual_amount, 0) - COALESCE(be.budget_amount, 0) AS variance,
  CASE WHEN be.budget_amount != 0
    THEN ROUND(((COALESCE(be.actual_amount, 0) - be.budget_amount) / be.budget_amount * 100)::numeric, 1)
    ELSE 0
  END AS variance_pct
FROM budget_entries be;

-- Vista conto economico aggregato
CREATE OR REPLACE VIEW v_profit_and_loss AS
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

-- ============================================================
-- FINE SCHEMA
-- ============================================================
