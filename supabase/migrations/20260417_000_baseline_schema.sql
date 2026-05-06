-- ============================================================================
-- 20260417_000_baseline_schema.sql
--
-- Schema baseline per i tenant del Gestionale NZ.
-- Generato automaticamente da tools/provisioning/build-baseline-migration.py
-- a partire dei file supabase/00*.sql nella radice del progetto.
--
-- Idempotente per design: tutti CREATE … IF NOT EXISTS / OR REPLACE.
-- - su NZ esistente: no-op
-- - su Made/Zago vergini: schema completo da zero
--
-- NON modificare a mano. Per ricompilare: cd frontend/tools/provisioning
--   && python3 build-baseline-migration.py
-- ============================================================================

-- ─── source: 001_complete_schema.sql ─────────────────────────────────────

-- ============================================================
-- GESTIONALE NZ — Schema Completo per Supabase
-- Script unificato: tutte le tabelle, viste, RLS, trigger
-- Pronto per esecuzione nel SQL Editor di Supabase
-- Data: 2026-04-02
-- ============================================================

-- ============================================================
-- ESTENSIONI
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

DO $do$ BEGIN
  -- ============================================================
-- ENUM TYPES
-- ============================================================
CREATE TYPE user_role AS ENUM ('super_advisor', 'cfo', 'coo', 'ceo', 'contabile');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE contract_type AS ENUM ('indeterminato', 'determinato');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE import_source AS ENUM ('csv_banca', 'csv_ade', 'csv_pos', 'api_pos', 'api_ade', 'manuale');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE import_status AS ENUM ('pending', 'processing', 'completed', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE transaction_type AS ENUM ('entrata', 'uscita');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE period_status AS ENUM ('aperto', 'in_chiusura', 'chiuso');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE contract_status AS ENUM ('attivo', 'in_scadenza', 'scaduto', 'disdettato');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE cost_macro_group AS ENUM (
  'costo_venduto', 'locazione', 'personale',
  'generali_amministrative', 'finanziarie', 'oneri_diversi'
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE payment_method AS ENUM (
  'bonifico_ordinario', 'bonifico_urgente', 'bonifico_sepa',
  'riba_30', 'riba_60', 'riba_90', 'riba_120',
  'rid', 'sdd_core', 'sdd_b2b',
  'rimessa_diretta',
  'carta_credito', 'carta_debito',
  'assegno', 'contanti', 'compensazione',
  'f24', 'mav', 'rav', 'bollettino_postale', 'altro'
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE payable_status AS ENUM (
  'da_pagare', 'in_scadenza', 'scaduto', 'pagato',
  'parziale', 'sospeso', 'rimandato', 'annullato'
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- ============================================================
-- FUNZIONE updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. SOCIETA (multi-tenant)
-- ============================================================
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  vat_number TEXT UNIQUE,
  fiscal_code TEXT,
  legal_address TEXT,
  pec TEXT,
  sdi_code TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_companies_updated ON companies;
CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 2. OUTLET / PUNTI VENDITA (schema completo)
-- ============================================================
CREATE TABLE IF NOT EXISTS outlets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  address TEXT,
  city TEXT,
  province TEXT,
  region TEXT,
  sqm NUMERIC(10,2),
  opening_date DATE,
  closing_date DATE,

  -- Tipo e centro commerciale
  outlet_type TEXT DEFAULT 'outlet',
  mall_name TEXT,
  mall_manager TEXT,

  -- Target fatturato/margine
  target_revenue_year1 NUMERIC(14,2),
  target_revenue_year2 NUMERIC(14,2),
  target_revenue_steady NUMERIC(14,2),
  target_margin_pct NUMERIC(5,2) DEFAULT 60,
  target_cogs_pct NUMERIC(5,2) DEFAULT 40,
  min_revenue_target NUMERIC(14,2),
  min_revenue_period TEXT,

  -- Costi fissi mensili
  rent_monthly NUMERIC(12,2),
  condo_marketing_monthly NUMERIC(12,2),
  staff_budget_monthly NUMERIC(14,2),
  admin_cost_monthly NUMERIC(14,2),

  -- Apertura
  setup_cost NUMERIC(14,2),
  deposit_amount NUMERIC(14,2),

  -- Stato BP
  bp_status TEXT DEFAULT 'bozza',

  -- Varie
  photo_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_outlets_company ON outlets(company_id);

DROP TRIGGER IF EXISTS trg_outlets_updated ON outlets;
CREATE TRIGGER trg_outlets_updated BEFORE UPDATE ON outlets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 3. UTENTI E PROFILI
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id),
  role user_role NOT NULL,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_outlet_access (
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id) ON DELETE CASCADE,
  can_write BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (user_id, outlet_id)
);

DROP TRIGGER IF EXISTS trg_user_profiles_updated ON user_profiles;
CREATE TRIGGER trg_user_profiles_updated BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 4. CATEGORIE COSTO DINAMICHE
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  macro_group cost_macro_group NOT NULL,
  is_fixed BOOLEAN DEFAULT TRUE,
  is_recurring BOOLEAN DEFAULT FALSE,
  is_system BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  matching_keywords TEXT[],
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cost_categories_company ON cost_categories(company_id);

-- Funzione: inizializza categorie di default
CREATE OR REPLACE FUNCTION init_default_cost_categories(p_company_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO cost_categories (company_id, code, name, macro_group, is_fixed, is_recurring, is_system, sort_order, matching_keywords) VALUES
    (p_company_id, 'LOC_OUTLET', 'Locazione outlet', 'locazione', TRUE, TRUE, TRUE, 10, '{"canone", "locazione", "affitto", "rent"}'),
    (p_company_id, 'COND_MKT', 'Spese condominiali e marketing', 'locazione', TRUE, TRUE, TRUE, 20, '{"condominiali", "marketing outlet", "gestione beni"}'),
    (p_company_id, 'COMP_AMM', 'Compenso amministratore', 'personale', TRUE, TRUE, TRUE, 30, '{"amministratore", "compenso amm"}'),
    (p_company_id, 'PERS_DIP', 'Personale dipendente', 'personale', TRUE, TRUE, TRUE, 40, '{"stipendi", "retribuzioni", "salari", "personale"}'),
    (p_company_id, 'ENERG_GAS', 'Energia elettrica e gas', 'generali_amministrative', TRUE, TRUE, FALSE, 50, '{"enel", "eni", "edison", "energia", "gas", "luce"}'),
    (p_company_id, 'TELEFON', 'Linee telefoniche', 'generali_amministrative', TRUE, TRUE, FALSE, 55, '{"telefon", "tim", "vodafone", "wind", "fastweb"}'),
    (p_company_id, 'PULIZIA', 'Pulizia e controllo estintori', 'generali_amministrative', TRUE, TRUE, FALSE, 60, '{"pulizia", "estintori", "cleaning"}'),
    (p_company_id, 'PUBBLICITA', 'Pubblicita e propaganda', 'generali_amministrative', FALSE, FALSE, FALSE, 70, '{"pubblicita", "propaganda", "advertising", "social"}'),
    (p_company_id, 'CONS_CONT', 'Consulenze contabili', 'generali_amministrative', TRUE, TRUE, FALSE, 80, '{"contabil", "commercialista", "bilancio"}'),
    (p_company_id, 'CONS_EPPI', 'Consulenze EPPI', 'generali_amministrative', TRUE, TRUE, FALSE, 85, '{"eppi"}'),
    (p_company_id, 'CONS_LAV', 'Consulenze del lavoro', 'generali_amministrative', TRUE, TRUE, FALSE, 90, '{"consulen lavoro", "paghe", "f24"}'),
    (p_company_id, 'CAN_SW', 'Canone software', 'generali_amministrative', TRUE, TRUE, FALSE, 100, '{"canone software", "licenza", "saas"}'),
    (p_company_id, 'ASS_SW', 'Assistenza software', 'generali_amministrative', FALSE, FALSE, FALSE, 105, '{"assistenza software", "manutenzione sw"}'),
    (p_company_id, 'COMM_CARTE', 'Commissioni carte e varie', 'generali_amministrative', FALSE, TRUE, FALSE, 110, '{"commissioni", "pos", "nexi", "sumup", "carte"}'),
    (p_company_id, 'VARIE_AMM', 'Varie amministrative e software gestionale', 'generali_amministrative', FALSE, FALSE, FALSE, 115, '{"varie amm", "software gestionale"}'),
    (p_company_id, 'CANCELL', 'Spese cancelleria', 'generali_amministrative', FALSE, FALSE, FALSE, 120, '{"cancelleria", "cartoleria", "toner"}'),
    (p_company_id, 'VIAGGI', 'Viaggi e trasferte', 'generali_amministrative', FALSE, FALSE, FALSE, 130, '{"viaggio", "trasferta", "treno", "aereo", "hotel"}'),
    (p_company_id, 'SPEDIZ', 'Spedizioni', 'generali_amministrative', FALSE, FALSE, FALSE, 140, '{"spedizione", "corriere", "brt", "gls", "dhl"}'),
    (p_company_id, 'MANUT', 'Spese manutenzione', 'generali_amministrative', FALSE, FALSE, FALSE, 150, '{"manutenzione", "riparazione"}'),
    (p_company_id, 'ASSICUR', 'Assicurazione', 'generali_amministrative', TRUE, TRUE, FALSE, 160, '{"assicurazione", "polizza"}'),
    (p_company_id, 'CONS_TEC', 'Consulenze tecniche', 'generali_amministrative', FALSE, FALSE, FALSE, 170, '{"consulenza tecnica", "consulente"}'),
    (p_company_id, 'CONS_LEG', 'Consulenze legali e notarili', 'generali_amministrative', FALSE, FALSE, FALSE, 175, '{"legale", "notaio", "avvocato"}'),
    (p_company_id, 'ALTRE_COMM', 'Altre commerciali', 'generali_amministrative', FALSE, FALSE, FALSE, 180, '{"commerciali"}'),
    (p_company_id, 'INT_PASS', 'Interessi passivi', 'finanziarie', TRUE, TRUE, TRUE, 200, '{"interessi", "finanziamento"}'),
    (p_company_id, 'ONERI_DIV', 'Oneri diversi di gestione', 'oneri_diversi', FALSE, FALSE, TRUE, 300, '{"oneri diversi", "sopravvenienze", "arrotondamenti"}');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. DIPENDENTI
-- ============================================================
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  fiscal_code TEXT,
  hire_date DATE,
  termination_date DATE,
  contract_type contract_type,
  level TEXT,
  weekly_hours NUMERIC(5,1),
  fte_ratio NUMERIC(4,2),
  gross_monthly_cost NUMERIC(12,2),
  gross_annual_cost NUMERIC(14,2),
  net_monthly_salary NUMERIC(12,2),
  role_description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_outlet ON employees(outlet_id);

CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);

DROP TRIGGER IF EXISTS trg_employees_updated ON employees;
CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 6. CONTI BANCARI (schema completo)
-- ============================================================
CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  iban TEXT,
  account_name TEXT,
  account_type TEXT DEFAULT 'conto_corrente',
  credit_line NUMERIC(14,2) DEFAULT 0,
  currency TEXT DEFAULT 'EUR',
  outlet_id UUID REFERENCES outlets(id),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. FORNITORI
-- ============================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  vat_number TEXT,
  fiscal_code TEXT,
  iban TEXT,
  default_payment_terms INTEGER DEFAULT 30,
  default_payment_method payment_method DEFAULT 'bonifico_ordinario',
  category TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, vat_number)
);

CREATE INDEX IF NOT EXISTS idx_suppliers_company ON suppliers(company_id);

-- ============================================================
-- 8. BUDGET ANNUALE PER OUTLET
-- ============================================================
CREATE TABLE IF NOT EXISTS annual_budgets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id),
  year INTEGER NOT NULL,
  revenue_target NUMERIC(14,2),
  revenue_bp NUMERIC(14,2),
  cost_of_goods_pct NUMERIC(5,4),
  rent_annual NUMERIC(14,2),
  condo_marketing_annual NUMERIC(14,2),
  staff_cost_annual NUMERIC(14,2),
  admin_compensation_annual NUMERIC(14,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, outlet_id, year)
);

CREATE TABLE IF NOT EXISTS budget_cost_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  budget_id UUID NOT NULL REFERENCES annual_budgets(id) ON DELETE CASCADE,
  cost_category_id UUID REFERENCES cost_categories(id),
  label TEXT,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  UNIQUE(budget_id, cost_category_id)
);

-- ============================================================
-- 9. CONSUNTIVO MENSILE PER OUTLET
-- ============================================================
CREATE TABLE IF NOT EXISTS monthly_actuals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  revenue NUMERIC(14,2) DEFAULT 0,
  purchases NUMERIC(14,2) DEFAULT 0,
  opening_inventory NUMERIC(14,2) DEFAULT 0,
  closing_inventory NUMERIC(14,2) DEFAULT 0,
  returns_to_warehouse NUMERIC(14,2) DEFAULT 0,
  status period_status DEFAULT 'aperto',
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES user_profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, outlet_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_actuals_period ON monthly_actuals(company_id, year, month);

DROP TRIGGER IF EXISTS trg_monthly_actuals_updated ON monthly_actuals;
CREATE TRIGGER trg_monthly_actuals_updated BEFORE UPDATE ON monthly_actuals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS monthly_cost_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  monthly_actual_id UUID NOT NULL REFERENCES monthly_actuals(id) ON DELETE CASCADE,
  cost_category_id UUID REFERENCES cost_categories(id),
  label TEXT,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  source import_source DEFAULT 'manuale',
  document_ref TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 10. FATTURATO GIORNALIERO (da POS/corrispettivi)
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_revenue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  gross_revenue NUMERIC(14,2) DEFAULT 0,
  net_revenue NUMERIC(14,2) DEFAULT 0,
  transactions_count INTEGER DEFAULT 0,
  avg_ticket NUMERIC(10,2) DEFAULT 0,
  cash_amount NUMERIC(14,2) DEFAULT 0,
  card_amount NUMERIC(14,2) DEFAULT 0,
  other_amount NUMERIC(14,2) DEFAULT 0,
  source import_source DEFAULT 'manuale',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, outlet_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_revenue_date ON daily_revenue(outlet_id, date);

-- ============================================================
-- 11. MOVIMENTI DI CASSA / BANCA
-- ============================================================
CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_account_id UUID REFERENCES bank_accounts(id),
  outlet_id UUID REFERENCES outlets(id),
  date DATE NOT NULL,
  value_date DATE,
  type transaction_type NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2),
  description TEXT,
  counterpart TEXT,
  cost_category_id UUID REFERENCES cost_categories(id),
  is_reconciled BOOLEAN DEFAULT FALSE,
  reconciled_with UUID,
  reconciled_at TIMESTAMPTZ,
  reconciled_by UUID REFERENCES user_profiles(id),
  source import_source DEFAULT 'manuale',
  import_batch_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_date ON cash_movements(company_id, date);

CREATE INDEX IF NOT EXISTS idx_cash_movements_outlet ON cash_movements(outlet_id, date);

CREATE INDEX IF NOT EXISTS idx_cash_movements_unreconciled ON cash_movements(is_reconciled) WHERE NOT is_reconciled;

-- ============================================================
-- 12. FINANZIAMENTI
-- ============================================================
CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  total_amount NUMERIC(14,2),
  interest_rate NUMERIC(6,4),
  start_date DATE,
  end_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loan_tranches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  tranche_number INTEGER NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  disbursement_date DATE NOT NULL,
  interest_rate NUMERIC(6,4),
  maturity_days INTEGER,
  accrued_interest NUMERIC(12,2),
  notes TEXT,
  UNIQUE(loan_id, tranche_number)
);

-- ============================================================
-- 13. IMPORTAZIONI
-- ============================================================
CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source import_source NOT NULL,
  status import_status DEFAULT 'pending',
  file_name TEXT,
  file_path TEXT,
  bank_account_id UUID REFERENCES bank_accounts(id),
  outlet_id UUID REFERENCES outlets(id),
  period_from DATE,
  period_to DATE,
  rows_total INTEGER DEFAULT 0,
  rows_imported INTEGER DEFAULT 0,
  rows_skipped INTEGER DEFAULT 0,
  rows_error INTEGER DEFAULT 0,
  error_log JSONB,
  imported_by UUID REFERENCES user_profiles(id),
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- 14. FATTURE ELETTRONICHE (da AdE)
-- ============================================================
CREATE TABLE IF NOT EXISTS electronic_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id),
  invoice_number TEXT,
  invoice_date DATE,
  supplier_name TEXT,
  supplier_vat TEXT,
  net_amount NUMERIC(14,2),
  vat_amount NUMERIC(14,2),
  gross_amount NUMERIC(14,2),
  cost_category_id UUID REFERENCES cost_categories(id),
  description TEXT,
  is_reconciled BOOLEAN DEFAULT FALSE,
  cash_movement_id UUID REFERENCES cash_movements(id),
  monthly_cost_line_id UUID REFERENCES monthly_cost_lines(id),
  source import_source DEFAULT 'csv_ade',
  import_batch_id UUID REFERENCES import_batches(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_date ON electronic_invoices(company_id, invoice_date);

-- ============================================================
-- 15. CORRISPETTIVI GIORNALIERI (da AdE)
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_receipts_ade (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id),
  date DATE NOT NULL,
  device_serial TEXT,
  total_amount NUMERIC(14,2),
  non_taxable_amount NUMERIC(14,2),
  vat_amount NUMERIC(14,2),
  is_reconciled BOOLEAN DEFAULT FALSE,
  daily_revenue_id UUID REFERENCES daily_revenue(id),
  source import_source DEFAULT 'csv_ade',
  import_batch_id UUID REFERENCES import_batches(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, outlet_id, date, device_serial)
);

-- ============================================================
-- 16. MAPPING CSV
-- ============================================================
CREATE TABLE IF NOT EXISTS csv_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  source import_source NOT NULL,
  name TEXT NOT NULL,
  column_mapping JSONB NOT NULL,
  date_format TEXT DEFAULT 'DD/MM/YYYY',
  decimal_separator TEXT DEFAULT ',',
  thousand_separator TEXT DEFAULT '.',
  skip_rows INTEGER DEFAULT 0,
  delimiter TEXT DEFAULT ';

',
  encoding TEXT DEFAULT 'UTF-8',
  auto_rules JSONB,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 17. CONTRATTI RICORRENTI
-- ============================================================
CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id),
  name TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  counterpart TEXT,
  contract_number TEXT,
  cost_category_id UUID REFERENCES cost_categories(id),
  monthly_amount NUMERIC(14,2),
  annual_amount NUMERIC(14,2),
  vat_rate NUMERIC(5,2) DEFAULT 22,
  deposit_amount NUMERIC(14,2),
  start_date DATE NOT NULL,
  end_date DATE,
  renewal_date DATE,
  notice_days INTEGER DEFAULT 180,
  notice_deadline DATE,
  auto_renewal BOOLEAN DEFAULT TRUE,
  renewal_period_months INTEGER DEFAULT 12,
  escalation_type TEXT,
  escalation_rate NUMERIC(6,4),
  escalation_date DATE,
  escalation_frequency_months INTEGER DEFAULT 12,
  min_revenue_clause NUMERIC(14,2),
  min_revenue_period TEXT,
  variable_rent_pct NUMERIC(5,4),
  variable_rent_threshold NUMERIC(14,2),
  sqm NUMERIC(10,2),
  status contract_status DEFAULT 'attivo',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contracts_company ON contracts(company_id);

CREATE INDEX IF NOT EXISTS idx_contracts_outlet ON contracts(outlet_id);

CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);

CREATE INDEX IF NOT EXISTS idx_contracts_renewal ON contracts(renewal_date) WHERE status = 'attivo';

-- Trigger: auto-calcolo notice_deadline
CREATE OR REPLACE FUNCTION calc_notice_deadline()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.end_date IS NOT NULL AND NEW.notice_days IS NOT NULL THEN
    NEW.notice_deadline := NEW.end_date - (NEW.notice_days || ' days')::INTERVAL;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contracts_notice ON contracts;
CREATE TRIGGER trg_contracts_notice
  BEFORE INSERT OR UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION calc_notice_deadline();

CREATE TABLE IF NOT EXISTS contract_deadlines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  deadline_date DATE NOT NULL,
  description TEXT NOT NULL,
  is_completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES user_profiles(id),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_deadlines_date ON contract_deadlines(deadline_date) WHERE NOT is_completed;

CREATE TABLE IF NOT EXISTS contract_amount_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  previous_amount NUMERIC(14,2),
  new_amount NUMERIC(14,2),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 18. SCADENZARIO (PAYABLES) — Schema completo
-- ============================================================
CREATE TABLE IF NOT EXISTS payables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id),
  supplier_id UUID REFERENCES suppliers(id),
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  original_due_date DATE,
  postponed_to DATE,
  postpone_count INTEGER DEFAULT 0,
  net_amount NUMERIC(14,2) NOT NULL,
  vat_amount NUMERIC(14,2) DEFAULT 0,
  gross_amount NUMERIC(14,2) NOT NULL,
  amount_paid NUMERIC(14,2) DEFAULT 0,
  amount_remaining NUMERIC(14,2),
  cost_category_id UUID REFERENCES cost_categories(id),
  payment_method payment_method,
  status payable_status DEFAULT 'da_pagare',
  priority INTEGER DEFAULT 0,
  suspend_reason TEXT,
  suspend_date DATE,
  resolved_date DATE,
  resolved_by UUID REFERENCES user_profiles(id),
  electronic_invoice_id UUID REFERENCES electronic_invoices(id),
  import_batch_id UUID REFERENCES import_batches(id),
  payment_date DATE,
  payment_bank_account_id UUID REFERENCES bank_accounts(id),
  cash_movement_id UUID REFERENCES cash_movements(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, supplier_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_payables_due_date ON payables(due_date)
  WHERE status IN ('da_pagare', 'in_scadenza', 'scaduto');

CREATE INDEX IF NOT EXISTS idx_payables_outlet ON payables(outlet_id, due_date);

CREATE INDEX IF NOT EXISTS idx_payables_supplier ON payables(supplier_id);

CREATE INDEX IF NOT EXISTS idx_payables_status ON payables(status);

-- Trigger: auto-gestione stato payables
CREATE OR REPLACE FUNCTION update_payable_status()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.original_due_date := NEW.due_date;
  END IF;

  NEW.amount_remaining := NEW.gross_amount - COALESCE(NEW.amount_paid, 0);

  IF NEW.status IN ('sospeso', 'annullato') THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF NEW.status = 'rimandato' AND NEW.postponed_to IS NOT NULL THEN
    NEW.due_date := NEW.postponed_to;
    NEW.status := 'da_pagare';
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF NEW.amount_remaining <= 0 THEN
    NEW.status := 'pagato';
  ELSIF COALESCE(NEW.amount_paid, 0) > 0 AND NEW.amount_remaining > 0 THEN
    NEW.status := 'parziale';
  ELSIF NEW.due_date < CURRENT_DATE THEN
    NEW.status := 'scaduto';
  ELSIF NEW.due_date <= CURRENT_DATE + 7 THEN
    NEW.status := 'in_scadenza';
  ELSE
    NEW.status := 'da_pagare';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payable_status ON payables;
CREATE TRIGGER trg_payable_status
  BEFORE INSERT OR UPDATE ON payables
  FOR EACH ROW EXECUTE FUNCTION update_payable_status();

-- Pagamenti parziali
CREATE TABLE IF NOT EXISTS payment_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payable_id UUID NOT NULL REFERENCES payables(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  bank_account_id UUID REFERENCES bank_accounts(id),
  cash_movement_id UUID REFERENCES cash_movements(id),
  payment_method payment_method,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit trail azioni su scadenze
CREATE TABLE IF NOT EXISTS payable_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payable_id UUID NOT NULL REFERENCES payables(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  old_status payable_status,
  new_status payable_status,
  old_due_date DATE,
  new_due_date DATE,
  amount NUMERIC(14,2),
  bank_account_id UUID REFERENCES bank_accounts(id),
  payment_method payment_method,
  note TEXT,
  performed_by UUID REFERENCES user_profiles(id),
  performed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payable_actions_payable ON payable_actions(payable_id);

CREATE INDEX IF NOT EXISTS idx_payable_actions_date ON payable_actions(performed_at DESC);

-- ============================================================
-- 19. SALDI BANCARI GIORNALIERI
-- ============================================================
CREATE TABLE IF NOT EXISTS bank_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  balance_accounting NUMERIC(14,2),
  balance_available NUMERIC(14,2),
  source import_source DEFAULT 'manuale',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bank_account_id, date)
);

CREATE INDEX IF NOT EXISTS idx_bank_balances_date ON bank_balances(bank_account_id, date DESC);

-- ============================================================
-- 20. BUDGET DI CASSA
-- ============================================================
CREATE TABLE IF NOT EXISTS cash_budget (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  target_min_balance NUMERIC(14,2),
  expected_inflows NUMERIC(14,2),
  expected_outflows NUMERIC(14,2),
  expected_net NUMERIC(14,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, year, month)
);

-- ============================================================
-- 21. TABELLE DI RELAZIONE OUTLET
-- ============================================================
CREATE TABLE IF NOT EXISTS outlet_bank_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT FALSE,
  notes TEXT,
  UNIQUE(outlet_id, bank_account_id)
);

CREATE TABLE IF NOT EXISTS outlet_suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT TRUE,
  default_payment_method payment_method,
  default_payment_terms INTEGER,
  avg_monthly_volume NUMERIC(14,2),
  notes TEXT,
  UNIQUE(outlet_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS outlet_cost_template (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  cost_category_id UUID NOT NULL REFERENCES cost_categories(id),
  budget_monthly NUMERIC(14,2),
  budget_annual NUMERIC(14,2),
  is_fixed BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  UNIQUE(outlet_id, cost_category_id)
);

-- ─── source: 002_views.sql ───────────────────────────────────────────────

-- ============================================================
-- GESTIONALE NZ — Viste SQL Complete
-- Tutte le viste: direzionali, operative, analitiche, tesoreria
-- ============================================================

-- ============================================================
-- A. P&L MENSILE (usa cost_categories dinamiche)
-- ============================================================
CREATE OR REPLACE VIEW v_pnl_monthly AS
SELECT
  ma.company_id,
  ma.outlet_id,
  o.name AS outlet_name,
  o.code AS outlet_code,
  ma.year,
  ma.month,
  TO_DATE(ma.year || '-' || LPAD(ma.month::TEXT, 2, '0') || '-01', 'YYYY-MM-DD') AS period_date,
  ma.status AS period_status,

  ma.revenue,
  ma.purchases,
  ma.opening_inventory,
  ma.closing_inventory,
  ma.returns_to_warehouse,
  (COALESCE(ma.purchases, 0) + COALESCE(ma.opening_inventory, 0)
   - COALESCE(ma.closing_inventory, 0) + COALESCE(ma.returns_to_warehouse, 0)) AS cogs,

  COALESCE(ma.revenue, 0) - (COALESCE(ma.purchases, 0) + COALESCE(ma.opening_inventory, 0)
   - COALESCE(ma.closing_inventory, 0) + COALESCE(ma.returns_to_warehouse, 0))
    AS contribution_margin,

  CASE WHEN COALESCE(ma.revenue, 0) > 0 THEN
    ROUND(
      (COALESCE(ma.revenue, 0) - (COALESCE(ma.purchases, 0) + COALESCE(ma.opening_inventory, 0)
       - COALESCE(ma.closing_inventory, 0) + COALESCE(ma.returns_to_warehouse, 0)))
      / ma.revenue * 100, 2)
  ELSE 0 END AS contribution_margin_pct,

  COALESCE(loc.total, 0) AS location_costs,
  COALESCE(staff.total, 0) AS staff_costs,
  COALESCE(ga.total, 0) AS general_admin_costs,
  COALESCE(fin.total, 0) AS financial_costs,
  COALESCE(oner.total, 0) AS other_costs,

  COALESCE(loc.total, 0) + COALESCE(staff.total, 0) + COALESCE(ga.total, 0)
    + COALESCE(oner.total, 0) AS total_opex,

  COALESCE(ma.revenue, 0)
    - (COALESCE(ma.purchases, 0) + COALESCE(ma.opening_inventory, 0)
       - COALESCE(ma.closing_inventory, 0) + COALESCE(ma.returns_to_warehouse, 0))
    - COALESCE(loc.total, 0) - COALESCE(staff.total, 0) - COALESCE(ga.total, 0)
    - COALESCE(oner.total, 0) AS ebitda,

  COALESCE(ma.revenue, 0)
    - (COALESCE(ma.purchases, 0) + COALESCE(ma.opening_inventory, 0)
       - COALESCE(ma.closing_inventory, 0) + COALESCE(ma.returns_to_warehouse, 0))
    - COALESCE(loc.total, 0) - COALESCE(staff.total, 0) - COALESCE(ga.total, 0)
    - COALESCE(oner.total, 0) - COALESCE(fin.total, 0) AS net_result

FROM monthly_actuals ma
JOIN outlets o ON o.id = ma.outlet_id

LEFT JOIN LATERAL (
  SELECT SUM(mcl.amount) AS total FROM monthly_cost_lines mcl
  JOIN cost_categories cc ON cc.id = mcl.cost_category_id
  WHERE mcl.monthly_actual_id = ma.id AND cc.macro_group = 'locazione'
) loc ON TRUE

LEFT JOIN LATERAL (
  SELECT SUM(mcl.amount) AS total FROM monthly_cost_lines mcl
  JOIN cost_categories cc ON cc.id = mcl.cost_category_id
  WHERE mcl.monthly_actual_id = ma.id AND cc.macro_group = 'personale'
) staff ON TRUE

LEFT JOIN LATERAL (
  SELECT SUM(mcl.amount) AS total FROM monthly_cost_lines mcl
  JOIN cost_categories cc ON cc.id = mcl.cost_category_id
  WHERE mcl.monthly_actual_id = ma.id AND cc.macro_group = 'generali_amministrative'
) ga ON TRUE

LEFT JOIN LATERAL (
  SELECT SUM(mcl.amount) AS total FROM monthly_cost_lines mcl
  JOIN cost_categories cc ON cc.id = mcl.cost_category_id
  WHERE mcl.monthly_actual_id = ma.id AND cc.macro_group = 'finanziarie'
) fin ON TRUE

LEFT JOIN LATERAL (
  SELECT SUM(mcl.amount) AS total FROM monthly_cost_lines mcl
  JOIN cost_categories cc ON cc.id = mcl.cost_category_id
  WHERE mcl.monthly_actual_id = ma.id AND cc.macro_group = 'oneri_diversi'
) oner ON TRUE;

-- ============================================================
-- B. DASHBOARD EXECUTIVE
-- ============================================================
CREATE OR REPLACE VIEW v_executive_dashboard AS
SELECT
  company_id, year, month, period_date,
  COUNT(DISTINCT outlet_id) AS active_outlets,
  SUM(revenue) AS total_revenue,
  SUM(cogs) AS total_cogs,
  SUM(contribution_margin) AS total_contribution_margin,
  CASE WHEN SUM(revenue) > 0 THEN
    ROUND(SUM(contribution_margin) / SUM(revenue) * 100, 2)
  ELSE 0 END AS avg_margin_pct,
  SUM(total_opex) AS total_opex,
  SUM(ebitda) AS total_ebitda,
  CASE WHEN SUM(revenue) > 0 THEN
    ROUND(SUM(ebitda) / SUM(revenue) * 100, 2)
  ELSE 0 END AS ebitda_margin_pct,
  SUM(net_result) AS total_net_result,
  ROUND(AVG(revenue), 2) AS avg_revenue_per_outlet,
  ROUND(AVG(ebitda), 2) AS avg_ebitda_per_outlet
FROM v_pnl_monthly
GROUP BY company_id, year, month, period_date;

-- ============================================================
-- C. BUDGET VS ACTUAL
-- ============================================================
CREATE OR REPLACE VIEW v_budget_vs_actual AS
SELECT
  pnl.company_id, pnl.outlet_id, pnl.outlet_name, pnl.outlet_code,
  pnl.year, pnl.month, pnl.period_date, pnl.period_status,
  ROUND(COALESCE(ab.revenue_target, 0) / 12, 2) AS budget_revenue_monthly,
  pnl.revenue AS actual_revenue,
  pnl.revenue - ROUND(COALESCE(ab.revenue_target, 0) / 12, 2) AS revenue_variance,
  CASE WHEN COALESCE(ab.revenue_target, 0) > 0 THEN
    ROUND((pnl.revenue - ROUND(ab.revenue_target / 12, 2)) / ROUND(ab.revenue_target / 12, 2) * 100, 2)
  ELSE NULL END AS revenue_variance_pct,
  ROUND(pnl.revenue * COALESCE(ab.cost_of_goods_pct, 0.40), 2) AS budget_cogs,
  pnl.cogs AS actual_cogs,
  pnl.contribution_margin AS actual_margin,
  pnl.contribution_margin_pct AS actual_margin_pct,
  ROUND((COALESCE(ab.rent_annual, 0) + COALESCE(ab.condo_marketing_annual, 0)) / 12, 2) AS budget_location_monthly,
  pnl.location_costs AS actual_location,
  ROUND(COALESCE(ab.staff_cost_annual, 0) / 12, 2) AS budget_staff_monthly,
  pnl.staff_costs AS actual_staff,
  pnl.ebitda AS actual_ebitda,
  CASE
    WHEN pnl.revenue >= ROUND(COALESCE(ab.revenue_target, 0) / 12, 2) * 1.05 THEN 'green'
    WHEN pnl.revenue >= ROUND(COALESCE(ab.revenue_target, 0) / 12, 2) * 0.90 THEN 'yellow'
    ELSE 'red'
  END AS revenue_signal,
  CASE
    WHEN pnl.ebitda > 0 AND pnl.contribution_margin_pct >= 55 THEN 'green'
    WHEN pnl.ebitda > 0 THEN 'yellow'
    ELSE 'red'
  END AS profitability_signal
FROM v_pnl_monthly pnl
LEFT JOIN annual_budgets ab
  ON ab.company_id = pnl.company_id AND ab.outlet_id = pnl.outlet_id AND ab.year = pnl.year;

-- ============================================================
-- D. RANKING OUTLET
-- ============================================================
CREATE OR REPLACE VIEW v_outlet_ranking AS
SELECT
  pnl.company_id, pnl.outlet_id, pnl.outlet_name, pnl.outlet_code, pnl.year,
  SUM(pnl.revenue) AS ytd_revenue,
  SUM(pnl.ebitda) AS ytd_ebitda,
  ROUND(AVG(pnl.contribution_margin_pct), 2) AS avg_margin_pct,
  SUM(pnl.staff_costs) AS ytd_staff_costs,
  CASE WHEN o.sqm > 0 THEN ROUND(SUM(pnl.revenue) / o.sqm, 2) ELSE NULL END AS revenue_per_sqm,
  CASE WHEN SUM(pnl.revenue) > 0 THEN
    ROUND(SUM(pnl.staff_costs) / SUM(pnl.revenue) * 100, 2)
  ELSE NULL END AS staff_cost_ratio,
  ab.revenue_bp AS bp_target,
  CASE WHEN COALESCE(ab.revenue_bp, 0) > 0 THEN
    ROUND(SUM(pnl.revenue) / ab.revenue_bp * 100, 2)
  ELSE NULL END AS bp_achievement_pct,
  RANK() OVER (ORDER BY SUM(pnl.revenue) DESC) AS rank_revenue,
  RANK() OVER (ORDER BY SUM(pnl.ebitda) DESC) AS rank_ebitda,
  RANK() OVER (ORDER BY CASE WHEN SUM(pnl.revenue) > 0 THEN SUM(pnl.ebitda) / SUM(pnl.revenue) ELSE 0 END DESC) AS rank_efficiency
FROM v_pnl_monthly pnl
JOIN outlets o ON o.id = pnl.outlet_id
LEFT JOIN annual_budgets ab ON ab.company_id = pnl.company_id AND ab.outlet_id = pnl.outlet_id AND ab.year = pnl.year
GROUP BY pnl.company_id, pnl.outlet_id, pnl.outlet_name, pnl.outlet_code, pnl.year, o.sqm, ab.revenue_bp;

-- ============================================================
-- E. TREND FATTURATO
-- ============================================================
CREATE OR REPLACE VIEW v_revenue_trend AS
SELECT
  dr.company_id, dr.outlet_id, o.name AS outlet_name, o.code AS outlet_code,
  DATE_TRUNC('month', dr.date)::DATE AS month_date,
  EXTRACT(YEAR FROM dr.date)::INTEGER AS year,
  EXTRACT(MONTH FROM dr.date)::INTEGER AS month,
  SUM(dr.gross_revenue) AS monthly_gross_revenue,
  SUM(dr.net_revenue) AS monthly_net_revenue,
  SUM(dr.transactions_count) AS monthly_transactions,
  CASE WHEN SUM(dr.transactions_count) > 0 THEN
    ROUND(SUM(dr.gross_revenue) / SUM(dr.transactions_count), 2)
  ELSE 0 END AS avg_ticket,
  SUM(dr.cash_amount) AS monthly_cash,
  SUM(dr.card_amount) AS monthly_card,
  CASE WHEN SUM(dr.gross_revenue) > 0 THEN
    ROUND(SUM(dr.card_amount) / SUM(dr.gross_revenue) * 100, 2)
  ELSE 0 END AS card_pct
FROM daily_revenue dr
JOIN outlets o ON o.id = dr.outlet_id
GROUP BY dr.company_id, dr.outlet_id, o.name, o.code, DATE_TRUNC('month', dr.date), EXTRACT(YEAR FROM dr.date), EXTRACT(MONTH FROM dr.date);

-- ============================================================
-- F. YoY
-- ============================================================
CREATE OR REPLACE VIEW v_yoy_comparison AS
SELECT
  curr.company_id, curr.outlet_id, curr.outlet_name, curr.outlet_code,
  curr.month, curr.year AS current_year, prev.year AS previous_year,
  curr.revenue AS current_revenue, prev.revenue AS previous_revenue,
  curr.revenue - COALESCE(prev.revenue, 0) AS revenue_delta,
  CASE WHEN COALESCE(prev.revenue, 0) > 0 THEN
    ROUND((curr.revenue - prev.revenue) / prev.revenue * 100, 2)
  ELSE NULL END AS revenue_growth_pct,
  curr.ebitda AS current_ebitda, prev.ebitda AS previous_ebitda,
  curr.ebitda - COALESCE(prev.ebitda, 0) AS ebitda_delta,
  curr.contribution_margin_pct AS current_margin_pct,
  prev.contribution_margin_pct AS previous_margin_pct
FROM v_pnl_monthly curr
LEFT JOIN v_pnl_monthly prev
  ON prev.company_id = curr.company_id AND prev.outlet_id = curr.outlet_id
  AND prev.year = curr.year - 1 AND prev.month = curr.month;

-- ============================================================
-- G. MOVIMENTI DA RICONCILIARE (con auto-categorizzazione)
-- ============================================================
CREATE OR REPLACE VIEW v_unreconciled_movements AS
SELECT
  cm.id, cm.company_id, cm.outlet_id, o.name AS outlet_name,
  ba.bank_name, ba.iban, cm.date, cm.value_date,
  cm.type, cm.amount, cm.balance_after,
  cm.description, cm.counterpart, cm.cost_category_id,
  cm.source,
  -- Suggerimento auto-categorizzazione via keywords
  (SELECT cc.id FROM cost_categories cc
   WHERE cc.company_id = cm.company_id AND cc.is_active = TRUE
   AND EXISTS (
     SELECT 1 FROM unnest(cc.matching_keywords) kw
     WHERE cm.description ILIKE '%' || kw || '%'
   )
   ORDER BY cc.sort_order LIMIT 1
  ) AS suggested_category_id,
  (CURRENT_DATE - cm.date) AS days_pending
FROM cash_movements cm
LEFT JOIN outlets o ON o.id = cm.outlet_id
LEFT JOIN bank_accounts ba ON ba.id = cm.bank_account_id
WHERE cm.is_reconciled = FALSE
ORDER BY cm.date DESC;

-- ============================================================
-- H. STATO CHIUSURA MENSILE
-- ============================================================
CREATE OR REPLACE VIEW v_closing_status AS
SELECT
  ma.company_id, ma.outlet_id, o.name AS outlet_name, o.code AS outlet_code,
  ma.year, ma.month, ma.status AS period_status,
  ma.revenue,
  (ma.revenue IS NOT NULL AND ma.revenue > 0) AS has_revenue,
  COALESCE(cl.cost_lines_count, 0) AS cost_lines_entered,
  COALESCE(cl.cost_lines_total, 0) AS total_costs_entered,
  COALESCE(unr.unreconciled_count, 0) AS unreconciled_movements,
  COALESCE(unr.unreconciled_amount, 0) AS unreconciled_amount,
  COALESCE(ade.receipts_days, 0) AS ade_receipts_days,
  EXTRACT(DAY FROM (DATE_TRUNC('month', TO_DATE(ma.year || '-' || ma.month || '-01', 'YYYY-MM-DD'))
    + INTERVAL '1 month' - INTERVAL '1 day'))::INTEGER AS days_in_month,
  ROUND(
    (CASE WHEN ma.revenue > 0 THEN 25 ELSE 0 END) +
    (CASE WHEN COALESCE(cl.cost_lines_count, 0) >= 5 THEN 25 ELSE COALESCE(cl.cost_lines_count, 0) * 5 END) +
    (CASE WHEN COALESCE(unr.unreconciled_count, 0) = 0 THEN 25 ELSE GREATEST(0, 25 - unr.unreconciled_count * 2) END) +
    (CASE WHEN COALESCE(ade.receipts_days, 0) >= 20 THEN 25 ELSE COALESCE(ade.receipts_days, 0) END)
  , 0) AS completeness_score
FROM monthly_actuals ma
JOIN outlets o ON o.id = ma.outlet_id
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cost_lines_count, COALESCE(SUM(amount), 0) AS cost_lines_total
  FROM monthly_cost_lines WHERE monthly_actual_id = ma.id
) cl ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS unreconciled_count, COALESCE(SUM(ABS(amount)), 0) AS unreconciled_amount
  FROM cash_movements
  WHERE company_id = ma.company_id AND outlet_id = ma.outlet_id
    AND EXTRACT(YEAR FROM date) = ma.year AND EXTRACT(MONTH FROM date) = ma.month
    AND is_reconciled = FALSE
) unr ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(DISTINCT date) AS receipts_days
  FROM daily_receipts_ade
  WHERE company_id = ma.company_id AND outlet_id = ma.outlet_id
    AND EXTRACT(YEAR FROM date) = ma.year AND EXTRACT(MONTH FROM date) = ma.month
) ade ON TRUE
ORDER BY ma.year DESC, ma.month DESC, o.name;

-- ============================================================
-- I. IMPORTAZIONI RECENTI
-- ============================================================
CREATE OR REPLACE VIEW v_recent_imports AS
SELECT
  ib.id, ib.company_id, ib.source, ib.status, ib.file_name,
  o.name AS outlet_name, ba.bank_name,
  ib.period_from, ib.period_to,
  ib.rows_total, ib.rows_imported, ib.rows_skipped, ib.rows_error,
  ib.imported_at, ib.completed_at,
  up.first_name || ' ' || up.last_name AS imported_by_name
FROM import_batches ib
LEFT JOIN outlets o ON o.id = ib.outlet_id
LEFT JOIN bank_accounts ba ON ba.id = ib.bank_account_id
LEFT JOIN user_profiles up ON up.id = ib.imported_by
ORDER BY ib.imported_at DESC;

-- ============================================================
-- J. OUTLET COMPARISON
-- ============================================================
CREATE OR REPLACE VIEW v_outlet_comparison AS
SELECT
  pnl.company_id, pnl.outlet_id, pnl.outlet_name, pnl.outlet_code,
  o.sqm, o.opening_date, o.rent_monthly,
  pnl.year, pnl.month,
  pnl.revenue, pnl.cogs, pnl.contribution_margin, pnl.contribution_margin_pct,
  pnl.location_costs, pnl.staff_costs, pnl.general_admin_costs, pnl.ebitda,
  CASE WHEN o.sqm > 0 THEN ROUND(pnl.revenue / o.sqm, 2) ELSE NULL END AS revenue_per_sqm,
  CASE WHEN o.sqm > 0 THEN ROUND(pnl.ebitda / o.sqm, 2) ELSE NULL END AS ebitda_per_sqm,
  CASE WHEN pnl.revenue > 0 THEN ROUND(pnl.staff_costs / pnl.revenue * 100, 2) ELSE NULL END AS staff_cost_ratio,
  CASE WHEN pnl.revenue > 0 THEN ROUND(pnl.location_costs / pnl.revenue * 100, 2) ELSE NULL END AS rent_ratio,
  CASE WHEN pnl.revenue > 0 THEN ROUND(pnl.ebitda / pnl.revenue * 100, 2) ELSE NULL END AS ebitda_margin_pct,
  CASE WHEN o.opening_date IS NOT NULL THEN
    EXTRACT(YEAR FROM AGE(
      TO_DATE(pnl.year || '-' || LPAD(pnl.month::TEXT, 2, '0') || '-01', 'YYYY-MM-DD'),
      o.opening_date
    )) * 12 + EXTRACT(MONTH FROM AGE(
      TO_DATE(pnl.year || '-' || LPAD(pnl.month::TEXT, 2, '0') || '-01', 'YYYY-MM-DD'),
      o.opening_date
    ))
  ELSE NULL END AS months_since_opening
FROM v_pnl_monthly pnl
JOIN outlets o ON o.id = pnl.outlet_id;

-- ============================================================
-- K. CASH POSITION
-- ============================================================
CREATE OR REPLACE VIEW v_cash_position AS
SELECT
  ba.company_id, ba.id AS bank_account_id, ba.bank_name, ba.iban,
  last_mov.date AS last_movement_date,
  last_mov.balance_after AS current_balance,
  COALESCE(current_month.inflows, 0) AS month_inflows,
  COALESCE(current_month.outflows, 0) AS month_outflows,
  COALESCE(current_month.net_flow, 0) AS month_net_flow,
  COALESCE(current_month.movements_count, 0) AS month_movements_count
FROM bank_accounts ba
LEFT JOIN LATERAL (
  SELECT date, balance_after FROM cash_movements
  WHERE bank_account_id = ba.id ORDER BY date DESC, created_at DESC LIMIT 1
) last_mov ON TRUE
LEFT JOIN LATERAL (
  SELECT
    SUM(CASE WHEN type = 'entrata' THEN amount ELSE 0 END) AS inflows,
    SUM(CASE WHEN type = 'uscita' THEN amount ELSE 0 END) AS outflows,
    SUM(CASE WHEN type = 'entrata' THEN amount ELSE -amount END) AS net_flow,
    COUNT(*) AS movements_count
  FROM cash_movements
  WHERE bank_account_id = ba.id
    AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)
    AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE)
) current_month ON TRUE
WHERE ba.is_active = TRUE;

-- ============================================================
-- L. STAFF ANALYSIS
-- ============================================================
CREATE OR REPLACE VIEW v_staff_analysis AS
SELECT
  e.company_id, e.outlet_id, o.name AS outlet_name, o.code AS outlet_code,
  COUNT(*) FILTER (WHERE e.is_active) AS active_employees,
  SUM(e.fte_ratio) FILTER (WHERE e.is_active) AS total_fte,
  SUM(e.weekly_hours) FILTER (WHERE e.is_active) AS total_weekly_hours,
  SUM(e.gross_monthly_cost) FILTER (WHERE e.is_active) AS total_monthly_cost,
  SUM(e.gross_annual_cost) FILTER (WHERE e.is_active) AS total_annual_cost,
  ROUND(AVG(e.gross_monthly_cost) FILTER (WHERE e.is_active), 2) AS avg_monthly_cost,
  CASE WHEN o.sqm > 0 THEN
    ROUND(SUM(e.gross_annual_cost) FILTER (WHERE e.is_active) / o.sqm, 2)
  ELSE NULL END AS annual_cost_per_sqm,
  ROUND(AVG(
    EXTRACT(YEAR FROM AGE(CURRENT_DATE, e.hire_date)) * 12 +
    EXTRACT(MONTH FROM AGE(CURRENT_DATE, e.hire_date))
  ) FILTER (WHERE e.is_active AND e.hire_date IS NOT NULL), 1) AS avg_tenure_months
FROM employees e
LEFT JOIN outlets o ON o.id = e.outlet_id
GROUP BY e.company_id, e.outlet_id, o.name, o.code, o.sqm;

-- ============================================================
-- M. LOANS OVERVIEW
-- ============================================================
CREATE OR REPLACE VIEW v_loans_overview AS
SELECT
  l.company_id, l.id AS loan_id, l.description, l.total_amount,
  l.interest_rate, l.start_date, l.end_date,
  COUNT(lt.id) AS tranches_count,
  SUM(lt.amount) AS total_disbursed,
  l.total_amount - COALESCE(SUM(lt.amount), 0) AS remaining_to_disburse,
  SUM(lt.accrued_interest) AS total_accrued_interest,
  MIN(lt.disbursement_date) AS first_disbursement,
  MAX(lt.disbursement_date) AS last_disbursement
FROM loans l
LEFT JOIN loan_tranches lt ON lt.loan_id = l.id
GROUP BY l.id, l.company_id, l.description, l.total_amount, l.interest_rate, l.start_date, l.end_date;

-- ============================================================
-- N. CONTRATTI IN SCADENZA
-- ============================================================
CREATE OR REPLACE VIEW v_contracts_expiring AS
SELECT
  c.id, c.company_id, c.outlet_id, o.name AS outlet_name,
  c.name AS contract_name, c.contract_type, c.counterpart,
  c.monthly_amount, c.end_date, c.notice_deadline, c.auto_renewal, c.status,
  (c.end_date - CURRENT_DATE) AS days_to_expiry,
  (c.notice_deadline - CURRENT_DATE) AS days_to_notice_deadline,
  CASE
    WHEN c.notice_deadline IS NOT NULL AND c.notice_deadline <= CURRENT_DATE THEN 'red'
    WHEN c.notice_deadline IS NOT NULL AND c.notice_deadline <= CURRENT_DATE + 30 THEN 'yellow'
    WHEN c.end_date IS NOT NULL AND c.end_date <= CURRENT_DATE + 90 THEN 'yellow'
    ELSE 'green'
  END AS alert_level
FROM contracts c
LEFT JOIN outlets o ON o.id = c.outlet_id
WHERE c.status IN ('attivo', 'in_scadenza')
ORDER BY CASE WHEN c.notice_deadline IS NOT NULL THEN c.notice_deadline ELSE c.end_date END ASC NULLS LAST;

-- ============================================================
-- O. COSTI RICORRENTI DA CONTRATTI
-- ============================================================
CREATE OR REPLACE VIEW v_recurring_costs AS
SELECT
  c.company_id, c.outlet_id, o.name AS outlet_name, o.code AS outlet_code,
  c.id AS contract_id, c.name AS contract_name, c.contract_type, c.counterpart,
  cc.id AS cost_category_id, cc.code AS cost_category_code, cc.name AS cost_category_name, cc.macro_group,
  c.monthly_amount, c.annual_amount,
  COALESCE(c.monthly_amount, ROUND(c.annual_amount / 12, 2)) AS monthly_expected
FROM contracts c
LEFT JOIN outlets o ON o.id = c.outlet_id
LEFT JOIN cost_categories cc ON cc.id = c.cost_category_id
WHERE c.status = 'attivo' AND (c.monthly_amount IS NOT NULL OR c.annual_amount IS NOT NULL)
ORDER BY o.name, cc.sort_order;

-- ============================================================
-- P. TESORERIA — Posizione dettagliata
-- ============================================================
CREATE OR REPLACE VIEW v_treasury_position AS
SELECT
  ba.company_id, ba.id AS bank_account_id, ba.bank_name, ba.iban,
  ba.account_type, ba.credit_line, ba.outlet_id, o.name AS outlet_name,
  lb.date AS last_balance_date,
  lb.balance_accounting AS current_balance,
  lb.balance_available AS available_balance,
  COALESCE(lb.balance_available, lb.balance_accounting, 0) + COALESCE(ba.credit_line, 0) AS total_available,
  COALESCE(recent.inflows_30d, 0) AS inflows_30d,
  COALESCE(recent.outflows_30d, 0) AS outflows_30d,
  COALESCE(recent.net_30d, 0) AS net_30d,
  COALESCE(lb.balance_accounting, 0) - COALESCE(prev_bal.balance_accounting, 0) AS balance_change_30d
FROM bank_accounts ba
LEFT JOIN outlets o ON o.id = ba.outlet_id
LEFT JOIN LATERAL (
  SELECT date, balance_accounting, balance_available
  FROM bank_balances WHERE bank_account_id = ba.id ORDER BY date DESC LIMIT 1
) lb ON TRUE
LEFT JOIN LATERAL (
  SELECT balance_accounting FROM bank_balances
  WHERE bank_account_id = ba.id AND date <= CURRENT_DATE - 30 ORDER BY date DESC LIMIT 1
) prev_bal ON TRUE
LEFT JOIN LATERAL (
  SELECT
    SUM(CASE WHEN type = 'entrata' THEN amount ELSE 0 END) AS inflows_30d,
    SUM(CASE WHEN type = 'uscita' THEN amount ELSE 0 END) AS outflows_30d,
    SUM(CASE WHEN type = 'entrata' THEN amount ELSE -amount END) AS net_30d
  FROM cash_movements WHERE bank_account_id = ba.id AND date >= CURRENT_DATE - 30
) recent ON TRUE
WHERE ba.is_active = TRUE
ORDER BY COALESCE(lb.balance_accounting, 0) DESC;

-- ============================================================
-- Q. SCADENZARIO FORNITORI
-- ============================================================
CREATE OR REPLACE VIEW v_payables_schedule AS
SELECT
  p.company_id, p.id AS payable_id, p.outlet_id,
  o.name AS outlet_name, o.code AS outlet_code,
  s.name AS supplier_name, s.category AS supplier_category,
  p.invoice_number, p.invoice_date, p.due_date,
  p.gross_amount, p.amount_paid,
  (p.gross_amount - COALESCE(p.amount_paid, 0)) AS amount_remaining,
  p.payment_method, p.status,
  cc.name AS cost_category_name, cc.macro_group,
  (p.due_date - CURRENT_DATE) AS days_to_due,
  CASE
    WHEN p.due_date < CURRENT_DATE THEN 'scaduto'
    WHEN p.due_date <= CURRENT_DATE + 7 THEN 'entro_7gg'
    WHEN p.due_date <= CURRENT_DATE + 15 THEN 'entro_15gg'
    WHEN p.due_date <= CURRENT_DATE + 30 THEN 'entro_30gg'
    WHEN p.due_date <= CURRENT_DATE + 60 THEN 'entro_60gg'
    ELSE 'oltre_60gg'
  END AS due_bucket,
  CASE
    WHEN p.due_date < CURRENT_DATE THEN 'red'
    WHEN p.due_date <= CURRENT_DATE + 7 THEN 'red'
    WHEN p.due_date <= CURRENT_DATE + 15 THEN 'yellow'
    WHEN p.due_date <= CURRENT_DATE + 30 THEN 'yellow'
    ELSE 'green'
  END AS urgency
FROM payables p
LEFT JOIN outlets o ON o.id = p.outlet_id
LEFT JOIN suppliers s ON s.id = p.supplier_id
LEFT JOIN cost_categories cc ON cc.id = p.cost_category_id
WHERE p.status IN ('da_pagare', 'in_scadenza', 'scaduto', 'parziale')
ORDER BY p.due_date ASC;

-- ============================================================
-- R. AGING FORNITORI
-- ============================================================
CREATE OR REPLACE VIEW v_payables_aging AS
SELECT
  p.company_id, s.name AS supplier_name,
  COUNT(*) AS invoices_count,
  SUM(p.gross_amount - COALESCE(p.amount_paid, 0)) AS total_remaining,
  SUM(CASE WHEN p.due_date >= CURRENT_DATE THEN p.gross_amount - COALESCE(p.amount_paid, 0) ELSE 0 END) AS not_yet_due,
  SUM(CASE WHEN p.due_date < CURRENT_DATE AND p.due_date >= CURRENT_DATE - 30 THEN p.gross_amount - COALESCE(p.amount_paid, 0) ELSE 0 END) AS overdue_0_30,
  SUM(CASE WHEN p.due_date < CURRENT_DATE - 30 AND p.due_date >= CURRENT_DATE - 60 THEN p.gross_amount - COALESCE(p.amount_paid, 0) ELSE 0 END) AS overdue_30_60,
  SUM(CASE WHEN p.due_date < CURRENT_DATE - 60 AND p.due_date >= CURRENT_DATE - 90 THEN p.gross_amount - COALESCE(p.amount_paid, 0) ELSE 0 END) AS overdue_60_90,
  SUM(CASE WHEN p.due_date < CURRENT_DATE - 90 THEN p.gross_amount - COALESCE(p.amount_paid, 0) ELSE 0 END) AS overdue_90_plus
FROM payables p
LEFT JOIN suppliers s ON s.id = p.supplier_id
WHERE p.status IN ('da_pagare', 'in_scadenza', 'scaduto', 'parziale')
GROUP BY p.company_id, s.name
ORDER BY SUM(p.gross_amount - COALESCE(p.amount_paid, 0)) DESC;

-- ============================================================
-- S. SCADENZARIO OPERATIVO (con azioni e audit)
-- ============================================================
CREATE OR REPLACE VIEW v_payables_operative AS
SELECT
  p.id, p.company_id, p.outlet_id, o.name AS outlet_name, o.code AS outlet_code,
  s.name AS supplier_name, s.category AS supplier_category,
  p.invoice_number, p.invoice_date, p.original_due_date, p.due_date,
  p.postponed_to, p.postpone_count,
  p.gross_amount, p.amount_paid, p.amount_remaining,
  p.payment_method, p.status, p.priority,
  p.suspend_reason, p.suspend_date,
  cc.name AS cost_category_name, cc.macro_group,
  CASE
    WHEN p.status = 'sospeso' THEN NULL
    WHEN p.status = 'pagato' THEN NULL
    ELSE (p.due_date - CURRENT_DATE)
  END AS days_to_due,
  CASE
    WHEN p.status = 'pagato' THEN 'paid'
    WHEN p.status = 'annullato' THEN 'cancelled'
    WHEN p.status = 'sospeso' THEN 'suspended'
    WHEN p.due_date < CURRENT_DATE THEN 'overdue'
    WHEN p.due_date <= CURRENT_DATE + 7 THEN 'urgent'
    WHEN p.due_date <= CURRENT_DATE + 30 THEN 'upcoming'
    ELSE 'ok'
  END AS urgency,
  last_action.action_type AS last_action_type,
  last_action.note AS last_action_note,
  last_action.performed_at AS last_action_date,
  last_action.performer_name AS last_action_by
FROM payables p
LEFT JOIN outlets o ON o.id = p.outlet_id
LEFT JOIN suppliers s ON s.id = p.supplier_id
LEFT JOIN cost_categories cc ON cc.id = p.cost_category_id
LEFT JOIN LATERAL (
  SELECT pa.action_type, pa.note, pa.performed_at,
    (up.first_name || ' ' || up.last_name) AS performer_name
  FROM payable_actions pa
  LEFT JOIN user_profiles up ON up.id = pa.performed_by
  WHERE pa.payable_id = p.id
  ORDER BY pa.performed_at DESC LIMIT 1
) last_action ON TRUE
ORDER BY
  CASE p.status
    WHEN 'scaduto' THEN 0 WHEN 'in_scadenza' THEN 1 WHEN 'parziale' THEN 2
    WHEN 'da_pagare' THEN 3 WHEN 'sospeso' THEN 4 WHEN 'rimandato' THEN 5
    WHEN 'pagato' THEN 6 WHEN 'annullato' THEN 7
  END,
  p.due_date ASC;

-- ============================================================
-- T. BANCHE MULTI-CONTO CON AGGREGAZIONE
-- ============================================================
CREATE OR REPLACE VIEW v_bank_accounts_detail AS
SELECT
  ba.company_id, ba.id AS bank_account_id, ba.bank_name, ba.iban,
  ba.account_name, ba.account_type, ba.credit_line,
  ba.outlet_id, o.name AS outlet_name,
  lb.date AS last_balance_date, lb.balance_accounting, lb.balance_available,
  COALESCE(lb.balance_available, lb.balance_accounting, 0) + COALESCE(ba.credit_line, 0) AS total_available,
  COALESCE(pay_7.total, 0) AS payables_7d,
  COALESCE(pay_30.total, 0) AS payables_30d,
  COALESCE(pay_60.total, 0) AS payables_60d,
  COALESCE(lb.balance_available, lb.balance_accounting, 0) + COALESCE(ba.credit_line, 0)
    - COALESCE(pay_30.total, 0) AS net_available_30d,
  COALESCE(curr.inflows, 0) AS month_inflows,
  COALESCE(curr.outflows, 0) AS month_outflows,
  COALESCE(curr.mov_count, 0) AS month_movements,
  COALESCE(lb.balance_accounting, 0) - COALESCE(prev.balance_accounting, 0) AS delta_30d
FROM bank_accounts ba
LEFT JOIN outlets o ON o.id = ba.outlet_id
LEFT JOIN LATERAL (
  SELECT date, balance_accounting, balance_available
  FROM bank_balances WHERE bank_account_id = ba.id ORDER BY date DESC LIMIT 1
) lb ON TRUE
LEFT JOIN LATERAL (
  SELECT balance_accounting FROM bank_balances
  WHERE bank_account_id = ba.id AND date <= CURRENT_DATE - 30 ORDER BY date DESC LIMIT 1
) prev ON TRUE
LEFT JOIN LATERAL (
  SELECT SUM(amount_remaining) AS total FROM payables
  WHERE payment_bank_account_id = ba.id AND status IN ('da_pagare','in_scadenza','scaduto','parziale')
    AND due_date <= CURRENT_DATE + 7
) pay_7 ON TRUE
LEFT JOIN LATERAL (
  SELECT SUM(amount_remaining) AS total FROM payables
  WHERE payment_bank_account_id = ba.id AND status IN ('da_pagare','in_scadenza','scaduto','parziale')
    AND due_date <= CURRENT_DATE + 30
) pay_30 ON TRUE
LEFT JOIN LATERAL (
  SELECT SUM(amount_remaining) AS total FROM payables
  WHERE payment_bank_account_id = ba.id AND status IN ('da_pagare','in_scadenza','scaduto','parziale')
    AND due_date <= CURRENT_DATE + 60
) pay_60 ON TRUE
LEFT JOIN LATERAL (
  SELECT
    SUM(CASE WHEN type = 'entrata' THEN amount ELSE 0 END) AS inflows,
    SUM(CASE WHEN type = 'uscita' THEN amount ELSE 0 END) AS outflows,
    COUNT(*) AS mov_count
  FROM cash_movements
  WHERE bank_account_id = ba.id
    AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)
    AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE)
) curr ON TRUE
WHERE ba.is_active = TRUE
ORDER BY COALESCE(lb.balance_accounting, 0) DESC;

CREATE OR REPLACE VIEW v_bank_totals AS
SELECT
  company_id,
  COUNT(*) AS accounts_count,
  SUM(balance_accounting) AS total_balance,
  SUM(total_available) AS total_available,
  SUM(COALESCE(credit_line, 0)) AS total_credit_lines,
  SUM(payables_7d) AS total_payables_7d,
  SUM(payables_30d) AS total_payables_30d,
  SUM(payables_60d) AS total_payables_60d,
  SUM(net_available_30d) AS total_net_available_30d,
  SUM(month_inflows) AS total_month_inflows,
  SUM(month_outflows) AS total_month_outflows
FROM v_bank_accounts_detail
GROUP BY company_id;

-- ============================================================
-- U. CASH FORECAST (12 settimane)
-- ============================================================
CREATE OR REPLACE VIEW v_cash_forecast AS
WITH
  current_total AS (
    SELECT ba.company_id,
      SUM(COALESCE(lb.balance_available, lb.balance_accounting, 0)) AS total_current_balance,
      SUM(COALESCE(ba.credit_line, 0)) AS total_credit_line
    FROM bank_accounts ba
    LEFT JOIN LATERAL (
      SELECT balance_accounting, balance_available
      FROM bank_balances WHERE bank_account_id = ba.id ORDER BY date DESC LIMIT 1
    ) lb ON TRUE
    WHERE ba.is_active = TRUE
    GROUP BY ba.company_id
  ),
  weekly_payables AS (
    SELECT company_id,
      DATE_TRUNC('week', due_date)::DATE AS week_start,
      SUM(gross_amount - COALESCE(amount_paid, 0)) AS outflows
    FROM payables
    WHERE status IN ('da_pagare', 'in_scadenza', 'scaduto') AND due_date <= CURRENT_DATE + 84
    GROUP BY company_id, DATE_TRUNC('week', due_date)
  ),
  avg_weekly_inflows AS (
    SELECT company_id,
      ROUND(SUM(CASE WHEN type = 'entrata' THEN amount ELSE 0 END) / 13, 2) AS avg_weekly_inflow
    FROM cash_movements WHERE date >= CURRENT_DATE - 91
    GROUP BY company_id
  ),
  weeks AS (SELECT generate_series(0, 11) AS week_num)
SELECT
  ct.company_id, w.week_num,
  (DATE_TRUNC('week', CURRENT_DATE) + (w.week_num || ' weeks')::INTERVAL)::DATE AS week_start,
  (DATE_TRUNC('week', CURRENT_DATE) + ((w.week_num + 1) || ' weeks')::INTERVAL - '1 day'::INTERVAL)::DATE AS week_end,
  ct.total_current_balance, ct.total_credit_line,
  COALESCE(awi.avg_weekly_inflow, 0) AS expected_inflows,
  COALESCE(wp.outflows, 0) AS scheduled_outflows,
  ct.total_current_balance
    + (w.week_num + 1) * COALESCE(awi.avg_weekly_inflow, 0)
    - COALESCE((SELECT SUM(sub_wp.outflows) FROM weekly_payables sub_wp
       WHERE sub_wp.company_id = ct.company_id
         AND sub_wp.week_start <= (DATE_TRUNC('week', CURRENT_DATE) + (w.week_num || ' weeks')::INTERVAL)::DATE), 0)
    AS projected_balance,
  CASE
    WHEN ct.total_current_balance + (w.week_num + 1) * COALESCE(awi.avg_weekly_inflow, 0)
      - COALESCE((SELECT SUM(sub_wp.outflows) FROM weekly_payables sub_wp
         WHERE sub_wp.company_id = ct.company_id
           AND sub_wp.week_start <= (DATE_TRUNC('week', CURRENT_DATE) + (w.week_num || ' weeks')::INTERVAL)::DATE), 0) < 0 THEN 'red'
    WHEN ct.total_current_balance + (w.week_num + 1) * COALESCE(awi.avg_weekly_inflow, 0)
      - COALESCE((SELECT SUM(sub_wp.outflows) FROM weekly_payables sub_wp
         WHERE sub_wp.company_id = ct.company_id
           AND sub_wp.week_start <= (DATE_TRUNC('week', CURRENT_DATE) + (w.week_num || ' weeks')::INTERVAL)::DATE), 0) < 50000 THEN 'yellow'
    ELSE 'green'
  END AS liquidity_signal
FROM current_total ct
CROSS JOIN weeks w
LEFT JOIN weekly_payables wp
  ON wp.company_id = ct.company_id
  AND wp.week_start = (DATE_TRUNC('week', CURRENT_DATE) + (w.week_num || ' weeks')::INTERVAL)::DATE
LEFT JOIN avg_weekly_inflows awi ON awi.company_id = ct.company_id
ORDER BY w.week_num;

-- ============================================================
-- V. OUTLET CARD (sintetico per outlet)
-- ============================================================
CREATE OR REPLACE VIEW v_outlet_card AS
SELECT
  o.id AS outlet_id, o.company_id, o.name, o.code, o.outlet_type, o.mall_name,
  o.address, o.city, o.province, o.sqm, o.opening_date, o.is_active, o.bp_status,
  o.target_revenue_year1, o.target_revenue_year2, o.target_revenue_steady,
  o.target_margin_pct, o.target_cogs_pct, o.min_revenue_target, o.min_revenue_period,
  o.rent_monthly, o.condo_marketing_monthly, o.staff_budget_monthly, o.admin_cost_monthly,
  o.setup_cost, o.deposit_amount,
  COALESCE(emp.active_count, 0) AS employees_count,
  COALESCE(emp.total_fte, 0) AS employees_fte,
  COALESCE(emp.monthly_cost, 0) AS employees_monthly_cost,
  COALESCE(banks.accounts_count, 0) AS bank_accounts_count,
  banks.primary_bank,
  COALESCE(suppl.suppliers_count, 0) AS suppliers_count,
  COALESCE(contr.contracts_count, 0) AS contracts_count,
  COALESCE(contr.monthly_commitments, 0) AS contracts_monthly_total,
  COALESCE(costs.categories_count, 0) AS cost_categories_count,
  COALESCE(costs.total_monthly_budget, 0) AS total_monthly_cost_budget,
  CASE WHEN o.opening_date IS NOT NULL THEN
    EXTRACT(YEAR FROM AGE(CURRENT_DATE, o.opening_date)) * 12 +
    EXTRACT(MONTH FROM AGE(CURRENT_DATE, o.opening_date))
  ELSE NULL END AS months_since_opening
FROM outlets o
LEFT JOIN LATERAL (
  SELECT COUNT(*) FILTER (WHERE is_active) AS active_count,
    COALESCE(SUM(fte_ratio) FILTER (WHERE is_active), 0) AS total_fte,
    COALESCE(SUM(gross_monthly_cost) FILTER (WHERE is_active), 0) AS monthly_cost
  FROM employees WHERE outlet_id = o.id
) emp ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS accounts_count,
    (SELECT ba.bank_name FROM outlet_bank_accounts oba
     JOIN bank_accounts ba ON ba.id = oba.bank_account_id
     WHERE oba.outlet_id = o.id AND oba.is_primary = TRUE LIMIT 1) AS primary_bank
  FROM outlet_bank_accounts WHERE outlet_id = o.id
) banks ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS suppliers_count
  FROM outlet_suppliers WHERE outlet_id = o.id AND is_active = TRUE
) suppl ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS contracts_count,
    COALESCE(SUM(COALESCE(monthly_amount, annual_amount / 12)), 0) AS monthly_commitments
  FROM contracts WHERE outlet_id = o.id AND status = 'attivo'
) contr ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS categories_count,
    COALESCE(SUM(budget_monthly), 0) AS total_monthly_budget
  FROM outlet_cost_template WHERE outlet_id = o.id AND is_active = TRUE
) costs ON TRUE;

-- ============================================================
-- W. BUSINESS PLAN OUTLET (proiezione 12 mesi)
-- ============================================================
CREATE OR REPLACE VIEW v_business_plan_outlet AS
SELECT
  o.company_id, o.id AS outlet_id, o.name AS outlet_name, o.code AS outlet_code,
  o.opening_date, o.bp_status,
  m.month_num,
  TO_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::TEXT || '-' || LPAD(m.month_num::TEXT, 2, '0') || '-01', 'YYYY-MM-DD') AS period_date,
  EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER AS year,
  COALESCE(actual.revenue, ROUND(COALESCE(o.target_revenue_year1, 0) / 12, 2)) AS revenue,
  CASE WHEN actual.revenue IS NOT NULL THEN 'reale' ELSE 'previsto' END AS revenue_type,
  COALESCE(actual.cogs, ROUND(COALESCE(o.target_revenue_year1, 0) / 12 * COALESCE(o.target_cogs_pct, 40) / 100, 2)) AS cogs,
  COALESCE(actual.revenue, ROUND(COALESCE(o.target_revenue_year1, 0) / 12, 2)) -
  COALESCE(actual.cogs, ROUND(COALESCE(o.target_revenue_year1, 0) / 12 * COALESCE(o.target_cogs_pct, 40) / 100, 2)) AS contribution_margin,
  COALESCE(o.rent_monthly, 0) AS rent,
  COALESCE(o.condo_marketing_monthly, 0) AS condo_marketing,
  COALESCE(o.admin_cost_monthly, 0) AS admin_cost,
  COALESCE(emp.monthly_cost, o.staff_budget_monthly, 0) AS staff_cost,
  COALESCE(tpl.total_other_costs, 0) AS other_costs,
  COALESCE(o.rent_monthly, 0) + COALESCE(o.condo_marketing_monthly, 0) +
  COALESCE(o.admin_cost_monthly, 0) + COALESCE(emp.monthly_cost, o.staff_budget_monthly, 0) +
  COALESCE(tpl.total_other_costs, 0) AS total_opex,
  (COALESCE(actual.revenue, ROUND(COALESCE(o.target_revenue_year1, 0) / 12, 2))
   - COALESCE(actual.cogs, ROUND(COALESCE(o.target_revenue_year1, 0) / 12 * COALESCE(o.target_cogs_pct, 40) / 100, 2)))
  - (COALESCE(o.rent_monthly, 0) + COALESCE(o.condo_marketing_monthly, 0) +
     COALESCE(o.admin_cost_monthly, 0) + COALESCE(emp.monthly_cost, o.staff_budget_monthly, 0) +
     COALESCE(tpl.total_other_costs, 0)) AS ebitda,
  CASE WHEN actual.revenue IS NOT NULL THEN 'consuntivo' ELSE 'budget' END AS data_source
FROM outlets o
CROSS JOIN generate_series(1, 12) AS m(month_num)
LEFT JOIN LATERAL (
  SELECT ma.revenue,
    (COALESCE(ma.purchases, 0) + COALESCE(ma.opening_inventory, 0)
     - COALESCE(ma.closing_inventory, 0) + COALESCE(ma.returns_to_warehouse, 0)) AS cogs
  FROM monthly_actuals ma
  WHERE ma.outlet_id = o.id AND ma.year = EXTRACT(YEAR FROM CURRENT_DATE) AND ma.month = m.month_num
) actual ON TRUE
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(gross_monthly_cost), 0) AS monthly_cost
  FROM employees WHERE outlet_id = o.id AND is_active = TRUE
) emp ON TRUE
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(budget_monthly), 0) AS total_other_costs
  FROM outlet_cost_template oct
  JOIN cost_categories cc ON cc.id = oct.cost_category_id
  WHERE oct.outlet_id = o.id AND oct.is_active = TRUE
    AND cc.macro_group NOT IN ('locazione', 'personale')
) tpl ON TRUE
WHERE o.is_active = TRUE;

-- ============================================================
-- X. BUSINESS PLAN CATENA (aggregato)
-- ============================================================
CREATE OR REPLACE VIEW v_business_plan_chain AS
SELECT
  company_id, year, month_num, period_date,
  COUNT(DISTINCT outlet_id) AS outlets_count,
  SUM(revenue) AS total_revenue,
  SUM(CASE WHEN data_source = 'consuntivo' THEN revenue ELSE 0 END) AS actual_revenue,
  SUM(CASE WHEN data_source = 'budget' THEN revenue ELSE 0 END) AS forecast_revenue,
  SUM(cogs) AS total_cogs,
  SUM(contribution_margin) AS total_contribution_margin,
  CASE WHEN SUM(revenue) > 0 THEN
    ROUND(SUM(contribution_margin) / SUM(revenue) * 100, 2)
  ELSE 0 END AS avg_margin_pct,
  SUM(rent) AS total_rent,
  SUM(condo_marketing) AS total_condo_marketing,
  SUM(admin_cost) AS total_admin_cost,
  SUM(staff_cost) AS total_staff_cost,
  SUM(other_costs) AS total_other_costs,
  SUM(total_opex) AS total_opex,
  SUM(ebitda) AS total_ebitda,
  CASE WHEN SUM(revenue) > 0 THEN
    ROUND(SUM(ebitda) / SUM(revenue) * 100, 2)
  ELSE 0 END AS ebitda_margin_pct,
  ROUND(AVG(revenue), 2) AS avg_revenue_per_outlet,
  ROUND(AVG(ebitda), 2) AS avg_ebitda_per_outlet
FROM v_business_plan_outlet
GROUP BY company_id, year, month_num, period_date
ORDER BY month_num;

-- ============================================================
-- Y. BP VS ACTUAL PER OUTLET
-- ============================================================
CREATE OR REPLACE VIEW v_bp_vs_actual_outlet AS
SELECT
  bp.company_id, bp.outlet_id, bp.outlet_name, bp.outlet_code,
  bp.year, bp.month_num AS month, bp.period_date, bp.data_source,
  bp.revenue AS bp_revenue,
  COALESCE(act.revenue, 0) AS actual_revenue,
  COALESCE(act.revenue, 0) - bp.revenue AS revenue_variance,
  CASE WHEN bp.revenue > 0 THEN
    ROUND((COALESCE(act.revenue, 0) - bp.revenue) / bp.revenue * 100, 2)
  ELSE NULL END AS revenue_variance_pct,
  bp.cogs AS bp_cogs,
  COALESCE(pnl.cogs, 0) AS actual_cogs,
  bp.total_opex AS bp_opex,
  COALESCE(pnl.total_opex, 0) AS actual_opex,
  COALESCE(pnl.total_opex, 0) - bp.total_opex AS opex_variance,
  bp.ebitda AS bp_ebitda,
  COALESCE(pnl.ebitda, 0) AS actual_ebitda,
  COALESCE(pnl.ebitda, 0) - bp.ebitda AS ebitda_variance,
  CASE
    WHEN COALESCE(act.revenue, 0) >= bp.revenue * 1.05 THEN 'green'
    WHEN COALESCE(act.revenue, 0) >= bp.revenue * 0.90 THEN 'yellow'
    WHEN bp.revenue > 0 THEN 'red'
    ELSE 'gray'
  END AS performance_signal
FROM v_business_plan_outlet bp
LEFT JOIN monthly_actuals act
  ON act.outlet_id = bp.outlet_id AND act.year = bp.year AND act.month = bp.month_num
LEFT JOIN v_pnl_monthly pnl
  ON pnl.outlet_id = bp.outlet_id AND pnl.year = bp.year AND pnl.month = bp.month_num;

-- ─── source: 003_rls_policies.sql ────────────────────────────────────────

-- ============================================================
-- GESTIONALE NZ — Row Level Security (RLS) Policies
-- Sicurezza a livello di riga per Supabase
-- ============================================================

-- ============================================================
-- ABILITAZIONE RLS SU TUTTE LE TABELLE
-- ============================================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

ALTER TABLE outlets ENABLE ROW LEVEL SECURITY;

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE user_outlet_access ENABLE ROW LEVEL SECURITY;

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

ALTER TABLE cost_categories ENABLE ROW LEVEL SECURITY;

ALTER TABLE annual_budgets ENABLE ROW LEVEL SECURITY;

ALTER TABLE budget_cost_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE monthly_actuals ENABLE ROW LEVEL SECURITY;

ALTER TABLE monthly_cost_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE daily_revenue ENABLE ROW LEVEL SECURITY;

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

ALTER TABLE loans ENABLE ROW LEVEL SECURITY;

ALTER TABLE loan_tranches ENABLE ROW LEVEL SECURITY;

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE electronic_invoices ENABLE ROW LEVEL SECURITY;

ALTER TABLE daily_receipts_ade ENABLE ROW LEVEL SECURITY;

ALTER TABLE csv_mappings ENABLE ROW LEVEL SECURITY;

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

ALTER TABLE contract_deadlines ENABLE ROW LEVEL SECURITY;

ALTER TABLE contract_amount_history ENABLE ROW LEVEL SECURITY;

ALTER TABLE payables ENABLE ROW LEVEL SECURITY;

ALTER TABLE payment_records ENABLE ROW LEVEL SECURITY;

ALTER TABLE payable_actions ENABLE ROW LEVEL SECURITY;

ALTER TABLE bank_balances ENABLE ROW LEVEL SECURITY;

ALTER TABLE cash_budget ENABLE ROW LEVEL SECURITY;

ALTER TABLE outlet_bank_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE outlet_suppliers ENABLE ROW LEVEL SECURITY;

ALTER TABLE outlet_cost_template ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- FUNZIONI HELPER
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_my_company_id()
RETURNS UUID AS $$
  SELECT company_id FROM user_profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION has_outlet_access(p_outlet_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
      AND (up.role = 'super_advisor'
        OR EXISTS (
          SELECT 1 FROM user_outlet_access uoa
          WHERE uoa.user_id = auth.uid() AND uoa.outlet_id = p_outlet_id
        ))
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION has_outlet_write(p_outlet_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
      AND (up.role = 'super_advisor'
        OR (up.role = 'contabile' AND EXISTS (
          SELECT 1 FROM user_outlet_access uoa
          WHERE uoa.user_id = auth.uid() AND uoa.outlet_id = p_outlet_id AND uoa.can_write = TRUE
        )))
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

DROP POLICY IF EXISTS companies_select ON companies;
-- ============================================================
-- POLICIES: COMPANIES
-- ============================================================
CREATE POLICY companies_select ON companies FOR SELECT
  USING (id = get_my_company_id());

DROP POLICY IF EXISTS companies_update ON companies;
CREATE POLICY companies_update ON companies FOR UPDATE
  USING (id = get_my_company_id() AND get_my_role() = 'super_advisor');

DROP POLICY IF EXISTS outlets_select ON outlets;
-- ============================================================
-- POLICIES: OUTLETS
-- ============================================================
CREATE POLICY outlets_select ON outlets FOR SELECT
  USING (company_id = get_my_company_id() AND has_outlet_access(id));

DROP POLICY IF EXISTS outlets_insert ON outlets;
CREATE POLICY outlets_insert ON outlets FOR INSERT
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = 'super_advisor');

DROP POLICY IF EXISTS outlets_update ON outlets;
CREATE POLICY outlets_update ON outlets FOR UPDATE
  USING (company_id = get_my_company_id() AND get_my_role() = 'super_advisor');

DROP POLICY IF EXISTS profiles_select ON user_profiles;
-- ============================================================
-- POLICIES: USER PROFILES
-- ============================================================
CREATE POLICY profiles_select ON user_profiles FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS profiles_own_update ON user_profiles;
CREATE POLICY profiles_own_update ON user_profiles FOR UPDATE
  USING (id = auth.uid());

DROP POLICY IF EXISTS cost_cat_select ON cost_categories;
-- ============================================================
-- POLICIES: COST CATEGORIES
-- ============================================================
CREATE POLICY cost_cat_select ON cost_categories FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS cost_cat_write ON cost_categories;
CREATE POLICY cost_cat_write ON cost_categories FOR ALL
  USING (company_id = get_my_company_id() AND get_my_role() = 'super_advisor');

DROP POLICY IF EXISTS employees_select ON employees;
-- ============================================================
-- POLICIES: EMPLOYEES
-- ============================================================
CREATE POLICY employees_select ON employees FOR SELECT
  USING (company_id = get_my_company_id()
    AND (outlet_id IS NULL OR has_outlet_access(outlet_id)));

DROP POLICY IF EXISTS employees_write ON employees;
CREATE POLICY employees_write ON employees FOR ALL
  USING (company_id = get_my_company_id()
    AND get_my_role() IN ('super_advisor', 'contabile'));

DROP POLICY IF EXISTS budgets_select ON annual_budgets;
-- ============================================================
-- POLICIES: BUDGET
-- ============================================================
CREATE POLICY budgets_select ON annual_budgets FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS budgets_write ON annual_budgets;
CREATE POLICY budgets_write ON annual_budgets FOR ALL
  USING (company_id = get_my_company_id() AND get_my_role() = 'super_advisor');

DROP POLICY IF EXISTS budget_lines_select ON budget_cost_lines;
CREATE POLICY budget_lines_select ON budget_cost_lines FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM annual_budgets ab WHERE ab.id = budget_id AND ab.company_id = get_my_company_id()
  ));

DROP POLICY IF EXISTS actuals_select ON monthly_actuals;
-- ============================================================
-- POLICIES: MONTHLY ACTUALS
-- ============================================================
CREATE POLICY actuals_select ON monthly_actuals FOR SELECT
  USING (company_id = get_my_company_id()
    AND (outlet_id IS NULL OR has_outlet_access(outlet_id)));

DROP POLICY IF EXISTS actuals_write ON monthly_actuals;
CREATE POLICY actuals_write ON monthly_actuals FOR ALL
  USING (company_id = get_my_company_id()
    AND get_my_role() IN ('super_advisor', 'contabile')
    AND (status != 'chiuso' OR get_my_role() = 'super_advisor'));

DROP POLICY IF EXISTS cost_lines_select ON monthly_cost_lines;
CREATE POLICY cost_lines_select ON monthly_cost_lines FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM monthly_actuals ma
    WHERE ma.id = monthly_actual_id AND ma.company_id = get_my_company_id()
  ));

DROP POLICY IF EXISTS cost_lines_write ON monthly_cost_lines;
CREATE POLICY cost_lines_write ON monthly_cost_lines FOR ALL
  USING (EXISTS (
    SELECT 1 FROM monthly_actuals ma
    WHERE ma.id = monthly_actual_id AND ma.company_id = get_my_company_id()
      AND get_my_role() IN ('super_advisor', 'contabile')
      AND (ma.status != 'chiuso' OR get_my_role() = 'super_advisor')
  ));

DROP POLICY IF EXISTS bank_select ON bank_accounts;
-- ============================================================
-- POLICIES: BANK ACCOUNTS & MOVEMENTS
-- ============================================================
CREATE POLICY bank_select ON bank_accounts FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS bank_write ON bank_accounts;
CREATE POLICY bank_write ON bank_accounts FOR ALL
  USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

DROP POLICY IF EXISTS cash_select ON cash_movements;
CREATE POLICY cash_select ON cash_movements FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS cash_write ON cash_movements;
CREATE POLICY cash_write ON cash_movements FOR ALL
  USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

DROP POLICY IF EXISTS balances_select ON bank_balances;
CREATE POLICY balances_select ON bank_balances FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM bank_accounts ba WHERE ba.id = bank_account_id AND ba.company_id = get_my_company_id()
  ));

DROP POLICY IF EXISTS balances_write ON bank_balances;
CREATE POLICY balances_write ON bank_balances FOR ALL
  USING (EXISTS (
    SELECT 1 FROM bank_accounts ba WHERE ba.id = bank_account_id AND ba.company_id = get_my_company_id()
      AND get_my_role() IN ('super_advisor', 'contabile')
  ));

DROP POLICY IF EXISTS revenue_select ON daily_revenue;
-- ============================================================
-- POLICIES: DAILY REVENUE
-- ============================================================
CREATE POLICY revenue_select ON daily_revenue FOR SELECT
  USING (company_id = get_my_company_id() AND has_outlet_access(outlet_id));

DROP POLICY IF EXISTS revenue_write ON daily_revenue;
CREATE POLICY revenue_write ON daily_revenue FOR ALL
  USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

DROP POLICY IF EXISTS loans_select ON loans;
-- ============================================================
-- POLICIES: LOANS
-- ============================================================
CREATE POLICY loans_select ON loans FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS loans_write ON loans;
CREATE POLICY loans_write ON loans FOR ALL
  USING (company_id = get_my_company_id() AND get_my_role() = 'super_advisor');

DROP POLICY IF EXISTS imports_select ON import_batches;
-- ============================================================
-- POLICIES: IMPORTS
-- ============================================================
CREATE POLICY imports_select ON import_batches FOR SELECT
  USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

DROP POLICY IF EXISTS imports_write ON import_batches;
CREATE POLICY imports_write ON import_batches FOR ALL
  USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

DROP POLICY IF EXISTS invoices_select ON electronic_invoices;
-- ============================================================
-- POLICIES: INVOICES & RECEIPTS
-- ============================================================
CREATE POLICY invoices_select ON electronic_invoices FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS invoices_write ON electronic_invoices;
CREATE POLICY invoices_write ON electronic_invoices FOR ALL
  USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

DROP POLICY IF EXISTS receipts_select ON daily_receipts_ade;
CREATE POLICY receipts_select ON daily_receipts_ade FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS receipts_write ON daily_receipts_ade;
CREATE POLICY receipts_write ON daily_receipts_ade FOR ALL
  USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

DROP POLICY IF EXISTS suppliers_select ON suppliers;
-- ============================================================
-- POLICIES: SUPPLIERS
-- ============================================================
CREATE POLICY suppliers_select ON suppliers FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS suppliers_write ON suppliers;
CREATE POLICY suppliers_write ON suppliers FOR ALL
  USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

DROP POLICY IF EXISTS contracts_select ON contracts;
-- ============================================================
-- POLICIES: CONTRACTS
-- ============================================================
CREATE POLICY contracts_select ON contracts FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS contracts_write ON contracts;
CREATE POLICY contracts_write ON contracts FOR ALL
  USING (company_id = get_my_company_id() AND get_my_role() = 'super_advisor');

DROP POLICY IF EXISTS deadlines_select ON contract_deadlines;
CREATE POLICY deadlines_select ON contract_deadlines FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM contracts c WHERE c.id = contract_id AND c.company_id = get_my_company_id()
  ));

DROP POLICY IF EXISTS amount_history_select ON contract_amount_history;
CREATE POLICY amount_history_select ON contract_amount_history FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM contracts c WHERE c.id = contract_id AND c.company_id = get_my_company_id()
  ));

DROP POLICY IF EXISTS payables_select ON payables;
-- ============================================================
-- POLICIES: PAYABLES & ACTIONS
-- ============================================================
CREATE POLICY payables_select ON payables FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS payables_write ON payables;
CREATE POLICY payables_write ON payables FOR ALL
  USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

DROP POLICY IF EXISTS payment_records_select ON payment_records;
CREATE POLICY payment_records_select ON payment_records FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM payables p WHERE p.id = payable_id AND p.company_id = get_my_company_id()
  ));

DROP POLICY IF EXISTS payment_records_write ON payment_records;
CREATE POLICY payment_records_write ON payment_records FOR ALL
  USING (EXISTS (
    SELECT 1 FROM payables p WHERE p.id = payable_id AND p.company_id = get_my_company_id()
      AND get_my_role() IN ('super_advisor', 'contabile')
  ));

DROP POLICY IF EXISTS actions_select ON payable_actions;
CREATE POLICY actions_select ON payable_actions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM payables p WHERE p.id = payable_id AND p.company_id = get_my_company_id()
  ));

DROP POLICY IF EXISTS actions_write ON payable_actions;
CREATE POLICY actions_write ON payable_actions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM payables p WHERE p.id = payable_id AND p.company_id = get_my_company_id()
      AND get_my_role() IN ('super_advisor', 'contabile')
  ));

DROP POLICY IF EXISTS cash_budget_select ON cash_budget;
-- ============================================================
-- POLICIES: CASH BUDGET
-- ============================================================
CREATE POLICY cash_budget_select ON cash_budget FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS cash_budget_write ON cash_budget;
CREATE POLICY cash_budget_write ON cash_budget FOR ALL
  USING (company_id = get_my_company_id() AND get_my_role() = 'super_advisor');

DROP POLICY IF EXISTS csv_select ON csv_mappings;
-- ============================================================
-- POLICIES: CSV MAPPINGS
-- ============================================================
CREATE POLICY csv_select ON csv_mappings FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS csv_write ON csv_mappings;
CREATE POLICY csv_write ON csv_mappings FOR ALL
  USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

DROP POLICY IF EXISTS outlet_banks_select ON outlet_bank_accounts;
-- ============================================================
-- POLICIES: JUNCTION TABLES (outlet_*)
-- ============================================================
CREATE POLICY outlet_banks_select ON outlet_bank_accounts FOR SELECT
  USING (has_outlet_access(outlet_id));

DROP POLICY IF EXISTS outlet_banks_write ON outlet_bank_accounts;
CREATE POLICY outlet_banks_write ON outlet_bank_accounts FOR ALL
  USING (get_my_role() = 'super_advisor');

DROP POLICY IF EXISTS outlet_suppliers_select ON outlet_suppliers;
CREATE POLICY outlet_suppliers_select ON outlet_suppliers FOR SELECT
  USING (has_outlet_access(outlet_id));

DROP POLICY IF EXISTS outlet_suppliers_write ON outlet_suppliers;
CREATE POLICY outlet_suppliers_write ON outlet_suppliers FOR ALL
  USING (get_my_role() = 'super_advisor');

DROP POLICY IF EXISTS outlet_costs_select ON outlet_cost_template;
CREATE POLICY outlet_costs_select ON outlet_cost_template FOR SELECT
  USING (has_outlet_access(outlet_id));

DROP POLICY IF EXISTS outlet_costs_write ON outlet_cost_template;
CREATE POLICY outlet_costs_write ON outlet_cost_template FOR ALL
  USING (get_my_role() = 'super_advisor');

-- ─── source: 007_add_outlet_fields_torino.sql ────────────────────────────

-- ============================================================
-- GESTIONALE NZ — Migrazione: campi aggiuntivi outlet + Torino
-- ============================================================

-- ============================================================
-- 1. NUOVI CAMPI TABELLA OUTLETS
-- Dati che emergono dai contratti outlet reali
-- ============================================================
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS sell_sqm NUMERIC(10,2);

-- Superficie di vendita
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS unit_code TEXT;

-- Codice unità nel centro (es. E10)
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS brand TEXT;

-- Insegna/marchio nel punto vendita
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS concedente TEXT;

-- Società concedente
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS contract_start DATE;

-- Data inizio contratto
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS contract_end DATE;

-- Data fine contratto
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS contract_duration_months INTEGER;

-- Durata mesi
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS contract_min_months INTEGER;

-- Durata minima (mesi)
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS delivery_date DATE;

-- Data consegna immobile
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS opening_confirmed BOOLEAN DEFAULT FALSE;

-- Apertura confermata
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rent_annual NUMERIC(14,2);

-- Canone annuo garantito
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rent_per_sqm NUMERIC(10,2);

-- €/mq canone
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rent_free_days INTEGER DEFAULT 0;

-- Giorni gratuiti iniziali
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS variable_rent_pct NUMERIC(5,2);

-- % canone variabile su VA
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS deposit_guarantee NUMERIC(14,2);

-- Fideiussione/deposito
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS advance_payment NUMERIC(14,2);

-- Anticipo canone versato
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rent_year2_annual NUMERIC(14,2);

-- Canone anno 2 (se diverso)
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rent_year3_annual NUMERIC(14,2);

-- Canone anno 3+ (se diverso)
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS exit_clause_month INTEGER;

-- Mese clausola recesso
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS exit_revenue_threshold NUMERIC(14,2);

-- Soglia fatturato per recesso

-- ============================================================
-- 2. INSERIMENTO OUTLET TORINO (caso reale)
-- ============================================================;

-- ─── source: 008_outlet_attachments.sql ──────────────────────────────────

-- ============================================================
-- GESTIONALE NZ — Tabella allegati outlet
-- Gestione documenti contratto e allegati
-- ============================================================

CREATE TABLE IF NOT EXISTS outlet_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  attachment_type TEXT NOT NULL,        -- 'contratto', 'allegato_a', 'allegato_b', 'condizioni_generali', 'planimetria', 'altro'
  label TEXT NOT NULL,                  -- Nome visualizzato: "Contratto affitto", "Allegato A - Planimetria", etc.
  file_name TEXT,                       -- Nome file originale
  file_path TEXT,                       -- Path in Supabase Storage
  file_size INTEGER,                    -- Dimensione in bytes
  mime_type TEXT,                       -- MIME type
  is_required BOOLEAN DEFAULT FALSE,    -- Se il documento è richiesto dal contratto
  is_uploaded BOOLEAN DEFAULT FALSE,    -- Se è stato caricato
  extracted_data JSONB,                 -- Dati estratti dall'analisi (per contratto principale)
  notes TEXT,
  uploaded_by UUID REFERENCES user_profiles(id),
  uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outlet_attachments_outlet ON outlet_attachments(outlet_id);

-- RLS
ALTER TABLE outlet_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attachments_select ON outlet_attachments;
CREATE POLICY attachments_select ON outlet_attachments FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS attachments_write ON outlet_attachments;
CREATE POLICY attachments_write ON outlet_attachments FOR ALL
  USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

DROP TRIGGER IF EXISTS trg_outlet_attachments_updated ON outlet_attachments;
CREATE TRIGGER trg_outlet_attachments_updated BEFORE UPDATE ON outlet_attachments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── source: 009_catch_all_missing.sql ───────────────────────────────────

-- ============================================================
-- GESTIONALE NZ — Script catch-all: crea tutto ciò che manca
-- Sicuro da eseguire anche se alcune tabelle esistono già
-- ============================================================

-- ============================================================
-- ESTENSIONI
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

DO $do$ BEGIN
  -- ============================================================
-- ENUM TYPES (con gestione "già esiste")
-- ============================================================
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('super_advisor','cfo','coo','ceo','contabile'); EXCEPTION WHEN duplicate_object THEN null; END $$;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  DO $$ BEGIN CREATE TYPE contract_type AS ENUM ('indeterminato','determinato'); EXCEPTION WHEN duplicate_object THEN null; END $$;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  DO $$ BEGIN CREATE TYPE import_source AS ENUM ('csv_banca','csv_ade','csv_pos','api_pos','api_ade','manuale'); EXCEPTION WHEN duplicate_object THEN null; END $$;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  DO $$ BEGIN CREATE TYPE import_status AS ENUM ('pending','processing','completed','error'); EXCEPTION WHEN duplicate_object THEN null; END $$;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  DO $$ BEGIN CREATE TYPE transaction_type AS ENUM ('entrata','uscita'); EXCEPTION WHEN duplicate_object THEN null; END $$;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  DO $$ BEGIN CREATE TYPE period_status AS ENUM ('aperto','in_chiusura','chiuso'); EXCEPTION WHEN duplicate_object THEN null; END $$;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  DO $$ BEGIN CREATE TYPE contract_status AS ENUM ('attivo','in_scadenza','scaduto','disdettato'); EXCEPTION WHEN duplicate_object THEN null; END $$;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  DO $$ BEGIN CREATE TYPE cost_macro_group AS ENUM ('costo_venduto','locazione','personale','generali_amministrative','finanziarie','oneri_diversi'); EXCEPTION WHEN duplicate_object THEN null; END $$;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  DO $$ BEGIN CREATE TYPE payment_method AS ENUM ('bonifico_ordinario','bonifico_urgente','bonifico_sepa','riba_30','riba_60','riba_90','riba_120','rid','sdd_core','sdd_b2b','rimessa_diretta','carta_credito','carta_debito','assegno','contanti','compensazione','f24','mav','rav','bollettino_postale','altro'); EXCEPTION WHEN duplicate_object THEN null; END $$;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  DO $$ BEGIN CREATE TYPE payable_status AS ENUM ('da_pagare','in_scadenza','scaduto','pagato','parziale','sospeso','rimandato','annullato'); EXCEPTION WHEN duplicate_object THEN null; END $$;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- ============================================================
-- FUNZIONE updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TABELLE (tutte con IF NOT EXISTS)
-- ============================================================

-- 1. COMPANIES
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL, vat_number TEXT UNIQUE, fiscal_code TEXT,
  legal_address TEXT, pec TEXT, sdi_code TEXT, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. OUTLETS
CREATE TABLE IF NOT EXISTS outlets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL, code TEXT, address TEXT, city TEXT, province TEXT, region TEXT,
  sqm NUMERIC(10,2), opening_date DATE, closing_date DATE,
  outlet_type TEXT DEFAULT 'outlet', mall_name TEXT, mall_manager TEXT,
  target_revenue_year1 NUMERIC(14,2), target_revenue_year2 NUMERIC(14,2),
  target_revenue_steady NUMERIC(14,2), target_margin_pct NUMERIC(5,2) DEFAULT 60,
  target_cogs_pct NUMERIC(5,2) DEFAULT 40, min_revenue_target NUMERIC(14,2),
  min_revenue_period TEXT, rent_monthly NUMERIC(12,2), condo_marketing_monthly NUMERIC(12,2),
  staff_budget_monthly NUMERIC(14,2), admin_cost_monthly NUMERIC(14,2),
  setup_cost NUMERIC(14,2), deposit_amount NUMERIC(14,2), bp_status TEXT DEFAULT 'bozza',
  photo_url TEXT, is_active BOOLEAN DEFAULT TRUE, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

-- 3. USER PROFILES
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id), role user_role NOT NULL,
  first_name TEXT, last_name TEXT, email TEXT, phone TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_outlet_access (
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id) ON DELETE CASCADE,
  can_write BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (user_id, outlet_id)
);

-- 4. COST CATEGORIES
CREATE TABLE IF NOT EXISTS cost_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL, name TEXT NOT NULL, macro_group cost_macro_group NOT NULL,
  is_fixed BOOLEAN DEFAULT TRUE, is_recurring BOOLEAN DEFAULT FALSE,
  is_system BOOLEAN DEFAULT FALSE, sort_order INTEGER DEFAULT 0,
  matching_keywords TEXT[], is_active BOOLEAN DEFAULT TRUE, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

-- 5. EMPLOYEES
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id),
  first_name TEXT NOT NULL, last_name TEXT NOT NULL, fiscal_code TEXT,
  hire_date DATE, termination_date DATE, contract_type contract_type,
  level TEXT, weekly_hours NUMERIC(5,1), fte_ratio NUMERIC(4,2),
  gross_monthly_cost NUMERIC(12,2), gross_annual_cost NUMERIC(14,2),
  net_monthly_salary NUMERIC(12,2), role_description TEXT,
  is_active BOOLEAN DEFAULT TRUE, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. BANK ACCOUNTS
CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL, iban TEXT, account_name TEXT,
  account_type TEXT DEFAULT 'conto_corrente', credit_line NUMERIC(14,2) DEFAULT 0,
  currency TEXT DEFAULT 'EUR', outlet_id UUID REFERENCES outlets(id),
  is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. SUPPLIERS
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL, vat_number TEXT, fiscal_code TEXT, iban TEXT,
  default_payment_terms INTEGER DEFAULT 30,
  default_payment_method payment_method DEFAULT 'bonifico_ordinario',
  category TEXT, notes TEXT, is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, vat_number)
);

-- 8. ANNUAL BUDGETS
CREATE TABLE IF NOT EXISTS annual_budgets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id), year INTEGER NOT NULL,
  revenue_target NUMERIC(14,2), revenue_bp NUMERIC(14,2),
  cost_of_goods_pct NUMERIC(5,4), rent_annual NUMERIC(14,2),
  condo_marketing_annual NUMERIC(14,2), staff_cost_annual NUMERIC(14,2),
  admin_compensation_annual NUMERIC(14,2), notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, outlet_id, year)
);

CREATE TABLE IF NOT EXISTS budget_cost_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  budget_id UUID NOT NULL REFERENCES annual_budgets(id) ON DELETE CASCADE,
  cost_category_id UUID REFERENCES cost_categories(id),
  label TEXT, amount NUMERIC(14,2) NOT NULL DEFAULT 0, notes TEXT,
  UNIQUE(budget_id, cost_category_id)
);

-- 9. MONTHLY ACTUALS
CREATE TABLE IF NOT EXISTS monthly_actuals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id), year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  revenue NUMERIC(14,2) DEFAULT 0, purchases NUMERIC(14,2) DEFAULT 0,
  opening_inventory NUMERIC(14,2) DEFAULT 0, closing_inventory NUMERIC(14,2) DEFAULT 0,
  returns_to_warehouse NUMERIC(14,2) DEFAULT 0,
  status period_status DEFAULT 'aperto', closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES user_profiles(id), notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, outlet_id, year, month)
);

CREATE TABLE IF NOT EXISTS monthly_cost_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  monthly_actual_id UUID NOT NULL REFERENCES monthly_actuals(id) ON DELETE CASCADE,
  cost_category_id UUID REFERENCES cost_categories(id),
  label TEXT, amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  source import_source DEFAULT 'manuale', document_ref TEXT, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. DAILY REVENUE
CREATE TABLE IF NOT EXISTS daily_revenue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  date DATE NOT NULL, gross_revenue NUMERIC(14,2) DEFAULT 0,
  net_revenue NUMERIC(14,2) DEFAULT 0, transactions_count INTEGER DEFAULT 0,
  avg_ticket NUMERIC(10,2) DEFAULT 0, cash_amount NUMERIC(14,2) DEFAULT 0,
  card_amount NUMERIC(14,2) DEFAULT 0, other_amount NUMERIC(14,2) DEFAULT 0,
  source import_source DEFAULT 'manuale', notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, outlet_id, date)
);

-- 11. CASH MOVEMENTS
CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_account_id UUID REFERENCES bank_accounts(id),
  outlet_id UUID REFERENCES outlets(id),
  date DATE NOT NULL, value_date DATE,
  type transaction_type NOT NULL, amount NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2), description TEXT, counterpart TEXT,
  cost_category_id UUID REFERENCES cost_categories(id),
  is_reconciled BOOLEAN DEFAULT FALSE, reconciled_with UUID,
  reconciled_at TIMESTAMPTZ, reconciled_by UUID REFERENCES user_profiles(id),
  source import_source DEFAULT 'manuale', import_batch_id UUID,
  notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. LOANS
CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  description TEXT NOT NULL, total_amount NUMERIC(14,2),
  interest_rate NUMERIC(6,4), start_date DATE, end_date DATE,
  notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loan_tranches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  tranche_number INTEGER NOT NULL, amount NUMERIC(14,2) NOT NULL,
  disbursement_date DATE NOT NULL, interest_rate NUMERIC(6,4),
  maturity_days INTEGER, accrued_interest NUMERIC(12,2), notes TEXT,
  UNIQUE(loan_id, tranche_number)
);

-- 13. IMPORT BATCHES
CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source import_source NOT NULL, status import_status DEFAULT 'pending',
  file_name TEXT, file_path TEXT,
  bank_account_id UUID REFERENCES bank_accounts(id),
  outlet_id UUID REFERENCES outlets(id),
  period_from DATE, period_to DATE,
  rows_total INTEGER DEFAULT 0, rows_imported INTEGER DEFAULT 0,
  rows_skipped INTEGER DEFAULT 0, rows_error INTEGER DEFAULT 0,
  error_log JSONB, imported_by UUID REFERENCES user_profiles(id),
  imported_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ
);

-- 14. ELECTRONIC INVOICES
CREATE TABLE IF NOT EXISTS electronic_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id), invoice_number TEXT,
  invoice_date DATE, supplier_name TEXT, supplier_vat TEXT,
  net_amount NUMERIC(14,2), vat_amount NUMERIC(14,2), gross_amount NUMERIC(14,2),
  cost_category_id UUID REFERENCES cost_categories(id), description TEXT,
  is_reconciled BOOLEAN DEFAULT FALSE,
  cash_movement_id UUID REFERENCES cash_movements(id),
  monthly_cost_line_id UUID REFERENCES monthly_cost_lines(id),
  source import_source DEFAULT 'csv_ade',
  import_batch_id UUID REFERENCES import_batches(id),
  notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. DAILY RECEIPTS ADE
CREATE TABLE IF NOT EXISTS daily_receipts_ade (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id),
  date DATE NOT NULL, device_serial TEXT,
  total_amount NUMERIC(14,2), non_taxable_amount NUMERIC(14,2), vat_amount NUMERIC(14,2),
  is_reconciled BOOLEAN DEFAULT FALSE,
  daily_revenue_id UUID REFERENCES daily_revenue(id),
  source import_source DEFAULT 'csv_ade',
  import_batch_id UUID REFERENCES import_batches(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, outlet_id, date, device_serial)
);

-- 16. CSV MAPPINGS
CREATE TABLE IF NOT EXISTS csv_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  source import_source NOT NULL, name TEXT NOT NULL,
  column_mapping JSONB NOT NULL, date_format TEXT DEFAULT 'DD/MM/YYYY',
  decimal_separator TEXT DEFAULT ',', thousand_separator TEXT DEFAULT '.',
  skip_rows INTEGER DEFAULT 0, delimiter TEXT DEFAULT ';

',
  encoding TEXT DEFAULT 'UTF-8', auto_rules JSONB,
  is_default BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. CONTRACTS
CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id), name TEXT NOT NULL,
  contract_type TEXT NOT NULL, counterpart TEXT, contract_number TEXT,
  cost_category_id UUID REFERENCES cost_categories(id),
  monthly_amount NUMERIC(14,2), annual_amount NUMERIC(14,2),
  vat_rate NUMERIC(5,2) DEFAULT 22, deposit_amount NUMERIC(14,2),
  start_date DATE NOT NULL, end_date DATE, renewal_date DATE,
  notice_days INTEGER DEFAULT 180, notice_deadline DATE,
  auto_renewal BOOLEAN DEFAULT TRUE, renewal_period_months INTEGER DEFAULT 12,
  escalation_type TEXT, escalation_rate NUMERIC(6,4), escalation_date DATE,
  escalation_frequency_months INTEGER DEFAULT 12,
  min_revenue_clause NUMERIC(14,2), min_revenue_period TEXT,
  variable_rent_pct NUMERIC(5,4), variable_rent_threshold NUMERIC(14,2),
  sqm NUMERIC(10,2), status contract_status DEFAULT 'attivo',
  notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contract_deadlines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  deadline_date DATE NOT NULL, description TEXT NOT NULL,
  is_completed BOOLEAN DEFAULT FALSE, completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES user_profiles(id), notes TEXT
);

CREATE TABLE IF NOT EXISTS contract_amount_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL, previous_amount NUMERIC(14,2),
  new_amount NUMERIC(14,2), reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 18. PAYABLES
CREATE TABLE IF NOT EXISTS payables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id), supplier_id UUID REFERENCES suppliers(id),
  invoice_number TEXT NOT NULL, invoice_date DATE NOT NULL, due_date DATE NOT NULL,
  original_due_date DATE, postponed_to DATE, postpone_count INTEGER DEFAULT 0,
  net_amount NUMERIC(14,2) NOT NULL, vat_amount NUMERIC(14,2) DEFAULT 0,
  gross_amount NUMERIC(14,2) NOT NULL, amount_paid NUMERIC(14,2) DEFAULT 0,
  amount_remaining NUMERIC(14,2), cost_category_id UUID REFERENCES cost_categories(id),
  payment_method payment_method, status payable_status DEFAULT 'da_pagare',
  priority INTEGER DEFAULT 0, suspend_reason TEXT, suspend_date DATE,
  resolved_date DATE, resolved_by UUID REFERENCES user_profiles(id),
  electronic_invoice_id UUID REFERENCES electronic_invoices(id),
  import_batch_id UUID REFERENCES import_batches(id),
  payment_date DATE, payment_bank_account_id UUID REFERENCES bank_accounts(id),
  cash_movement_id UUID REFERENCES cash_movements(id),
  notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, supplier_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS payment_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payable_id UUID NOT NULL REFERENCES payables(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL, amount NUMERIC(14,2) NOT NULL,
  bank_account_id UUID REFERENCES bank_accounts(id),
  cash_movement_id UUID REFERENCES cash_movements(id),
  payment_method payment_method, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payable_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payable_id UUID NOT NULL REFERENCES payables(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL, old_status payable_status, new_status payable_status,
  old_due_date DATE, new_due_date DATE, amount NUMERIC(14,2),
  bank_account_id UUID REFERENCES bank_accounts(id),
  payment_method payment_method, note TEXT,
  performed_by UUID REFERENCES user_profiles(id),
  performed_at TIMESTAMPTZ DEFAULT NOW()
);

-- 19. BANK BALANCES
CREATE TABLE IF NOT EXISTS bank_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL, balance_accounting NUMERIC(14,2),
  balance_available NUMERIC(14,2), source import_source DEFAULT 'manuale',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bank_account_id, date)
);

-- 20. CASH BUDGET
CREATE TABLE IF NOT EXISTS cash_budget (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year INTEGER NOT NULL, month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  target_min_balance NUMERIC(14,2), expected_inflows NUMERIC(14,2),
  expected_outflows NUMERIC(14,2), expected_net NUMERIC(14,2), notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, year, month)
);

-- 21. JUNCTION TABLES
CREATE TABLE IF NOT EXISTS outlet_bank_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT FALSE, notes TEXT,
  UNIQUE(outlet_id, bank_account_id)
);

CREATE TABLE IF NOT EXISTS outlet_suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT TRUE, default_payment_method payment_method,
  default_payment_terms INTEGER, avg_monthly_volume NUMERIC(14,2), notes TEXT,
  UNIQUE(outlet_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS outlet_cost_template (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  cost_category_id UUID NOT NULL REFERENCES cost_categories(id),
  budget_monthly NUMERIC(14,2), budget_annual NUMERIC(14,2),
  is_fixed BOOLEAN DEFAULT TRUE, is_active BOOLEAN DEFAULT TRUE, notes TEXT,
  UNIQUE(outlet_id, cost_category_id)
);

-- 22. OUTLET ATTACHMENTS (nuova)
CREATE TABLE IF NOT EXISTS outlet_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  attachment_type TEXT NOT NULL, label TEXT NOT NULL,
  file_name TEXT, file_path TEXT, file_size INTEGER, mime_type TEXT,
  is_required BOOLEAN DEFAULT FALSE, is_uploaded BOOLEAN DEFAULT FALSE,
  extracted_data JSONB, notes TEXT,
  uploaded_by UUID REFERENCES user_profiles(id), uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDICI (CREATE INDEX IF NOT EXISTS)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_outlets_company ON outlets(company_id);

CREATE INDEX IF NOT EXISTS idx_employees_outlet ON employees(outlet_id);

CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);

CREATE INDEX IF NOT EXISTS idx_cost_categories_company ON cost_categories(company_id);

CREATE INDEX IF NOT EXISTS idx_monthly_actuals_period ON monthly_actuals(company_id, year, month);

CREATE INDEX IF NOT EXISTS idx_daily_revenue_date ON daily_revenue(outlet_id, date);

CREATE INDEX IF NOT EXISTS idx_cash_movements_date ON cash_movements(company_id, date);

CREATE INDEX IF NOT EXISTS idx_cash_movements_outlet ON cash_movements(outlet_id, date);

CREATE INDEX IF NOT EXISTS idx_invoices_date ON electronic_invoices(company_id, invoice_date);

CREATE INDEX IF NOT EXISTS idx_contracts_company ON contracts(company_id);

CREATE INDEX IF NOT EXISTS idx_contracts_outlet ON contracts(outlet_id);

CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);

CREATE INDEX IF NOT EXISTS idx_payables_outlet ON payables(outlet_id, due_date);

CREATE INDEX IF NOT EXISTS idx_payables_supplier ON payables(supplier_id);

CREATE INDEX IF NOT EXISTS idx_payables_status ON payables(status);

CREATE INDEX IF NOT EXISTS idx_payable_actions_payable ON payable_actions(payable_id);

CREATE INDEX IF NOT EXISTS idx_bank_balances_date ON bank_balances(bank_account_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_suppliers_company ON suppliers(company_id);

CREATE INDEX IF NOT EXISTS idx_outlet_attachments_outlet ON outlet_attachments(outlet_id);

-- ============================================================
-- CAMPI AGGIUNTIVI OUTLET (da 007)
-- ============================================================
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS sell_sqm NUMERIC(10,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS unit_code TEXT;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS brand TEXT;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS concedente TEXT;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS contract_start DATE;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS contract_end DATE;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS contract_duration_months INTEGER;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS contract_min_months INTEGER;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS delivery_date DATE;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS opening_confirmed BOOLEAN DEFAULT FALSE;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rent_annual NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rent_per_sqm NUMERIC(10,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rent_free_days INTEGER DEFAULT 0;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS variable_rent_pct NUMERIC(5,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS deposit_guarantee NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS advance_payment NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rent_year2_annual NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rent_year3_annual NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS exit_clause_month INTEGER;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS exit_revenue_threshold NUMERIC(14,2);

DROP TRIGGER IF EXISTS trg_companies_updated ON companies;
-- ============================================================
-- TRIGGER (con gestione "già esiste")
-- ============================================================
DO $$ BEGIN
  CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN null; END $$;

DROP TRIGGER IF EXISTS trg_outlets_updated ON outlets;
DO $$ BEGIN
  CREATE TRIGGER trg_outlets_updated BEFORE UPDATE ON outlets FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN null; END $$;

DROP TRIGGER IF EXISTS trg_user_profiles_updated ON user_profiles;
DO $$ BEGIN
  CREATE TRIGGER trg_user_profiles_updated BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN null; END $$;

DROP TRIGGER IF EXISTS trg_employees_updated ON employees;
DO $$ BEGIN
  CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN null; END $$;

DROP TRIGGER IF EXISTS trg_monthly_actuals_updated ON monthly_actuals;
DO $$ BEGIN
  CREATE TRIGGER trg_monthly_actuals_updated BEFORE UPDATE ON monthly_actuals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN null; END $$;

DROP TRIGGER IF EXISTS trg_outlet_attachments_updated ON outlet_attachments;
DO $$ BEGIN
  CREATE TRIGGER trg_outlet_attachments_updated BEFORE UPDATE ON outlet_attachments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Trigger contracts: auto-calcolo notice_deadline
CREATE OR REPLACE FUNCTION calc_notice_deadline()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.end_date IS NOT NULL AND NEW.notice_days IS NOT NULL THEN
    NEW.notice_deadline := NEW.end_date - (NEW.notice_days || ' days')::INTERVAL;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contracts_notice ON contracts;
DO $$ BEGIN
  CREATE TRIGGER trg_contracts_notice BEFORE INSERT OR UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION calc_notice_deadline();
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Trigger payables: auto-gestione stato
CREATE OR REPLACE FUNCTION update_payable_status()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.original_due_date := NEW.due_date; END IF;
  NEW.amount_remaining := NEW.gross_amount - COALESCE(NEW.amount_paid, 0);
  IF NEW.status IN ('sospeso', 'annullato') THEN NEW.updated_at := NOW(); RETURN NEW; END IF;
  IF NEW.status = 'rimandato' AND NEW.postponed_to IS NOT NULL THEN
    NEW.due_date := NEW.postponed_to; NEW.status := 'da_pagare'; NEW.updated_at := NOW(); RETURN NEW;
  END IF;
  IF NEW.amount_remaining <= 0 THEN NEW.status := 'pagato';
  ELSIF COALESCE(NEW.amount_paid, 0) > 0 AND NEW.amount_remaining > 0 THEN NEW.status := 'parziale';
  ELSIF NEW.due_date < CURRENT_DATE THEN NEW.status := 'scaduto';
  ELSIF NEW.due_date <= CURRENT_DATE + 7 THEN NEW.status := 'in_scadenza';
  ELSE NEW.status := 'da_pagare';
  END IF;
  NEW.updated_at := NOW(); RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payable_status ON payables;
DO $$ BEGIN
  CREATE TRIGGER trg_payable_status BEFORE INSERT OR UPDATE ON payables FOR EACH ROW EXECUTE FUNCTION update_payable_status();
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Funzione categorie di default
CREATE OR REPLACE FUNCTION init_default_cost_categories(p_company_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO cost_categories (company_id, code, name, macro_group, is_fixed, is_recurring, is_system, sort_order) VALUES
    (p_company_id, 'LOC_OUTLET', 'Locazione outlet', 'locazione', TRUE, TRUE, TRUE, 10),
    (p_company_id, 'COND_MKT', 'Spese condominiali e marketing', 'locazione', TRUE, TRUE, TRUE, 20),
    (p_company_id, 'COMP_AMM', 'Compenso amministratore', 'personale', TRUE, TRUE, TRUE, 30),
    (p_company_id, 'PERS_DIP', 'Personale dipendente', 'personale', TRUE, TRUE, TRUE, 40),
    (p_company_id, 'INT_PASS', 'Interessi passivi', 'finanziarie', TRUE, TRUE, TRUE, 200),
    (p_company_id, 'ONERI_DIV', 'Oneri diversi di gestione', 'oneri_diversi', FALSE, FALSE, TRUE, 300)
  ON CONFLICT (company_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RLS + HELPER FUNCTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_my_company_id()
RETURNS UUID AS $$
  SELECT company_id FROM user_profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION has_outlet_access(p_outlet_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up WHERE up.id = auth.uid()
      AND (up.role = 'super_advisor' OR EXISTS (
        SELECT 1 FROM user_outlet_access uoa WHERE uoa.user_id = auth.uid() AND uoa.outlet_id = p_outlet_id
      ))
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Abilita RLS su tutte le tabelle
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'companies','outlets','user_profiles','user_outlet_access','employees',
    'cost_categories','annual_budgets','budget_cost_lines','monthly_actuals',
    'monthly_cost_lines','daily_revenue','bank_accounts','cash_movements',
    'loans','loan_tranches','import_batches','electronic_invoices',
    'daily_receipts_ade','csv_mappings','suppliers','contracts',
    'contract_deadlines','contract_amount_history','payables','payment_records',
    'payable_actions','bank_balances','cash_budget','outlet_bank_accounts',
    'outlet_suppliers','outlet_cost_template','outlet_attachments'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ============================================================
-- RLS POLICIES (DROP IF EXISTS + CREATE)
-- Ricreiamo tutto per essere sicuri
-- ============================================================

-- Helper: drop policy se esiste
CREATE OR REPLACE FUNCTION drop_policy_if_exists(p_name TEXT, p_table TEXT) RETURNS VOID AS $$
BEGIN EXECUTE format('DROP POLICY IF EXISTS %I ON %I', p_name, p_table); END;
$$ LANGUAGE plpgsql;

-- COMPANIES
SELECT drop_policy_if_exists('companies_select', 'companies');

SELECT drop_policy_if_exists('companies_update', 'companies');

DROP POLICY IF EXISTS companies_select ON companies;
CREATE POLICY companies_select ON companies FOR SELECT USING (id = get_my_company_id());

DROP POLICY IF EXISTS companies_update ON companies;
CREATE POLICY companies_update ON companies FOR UPDATE USING (id = get_my_company_id() AND get_my_role() = 'super_advisor');

-- OUTLETS
SELECT drop_policy_if_exists('outlets_select', 'outlets');

SELECT drop_policy_if_exists('outlets_insert', 'outlets');

SELECT drop_policy_if_exists('outlets_update', 'outlets');

DROP POLICY IF EXISTS outlets_select ON outlets;
CREATE POLICY outlets_select ON outlets FOR SELECT USING (company_id = get_my_company_id() AND has_outlet_access(id));

DROP POLICY IF EXISTS outlets_insert ON outlets;
CREATE POLICY outlets_insert ON outlets FOR INSERT WITH CHECK (company_id = get_my_company_id() AND get_my_role() = 'super_advisor');

DROP POLICY IF EXISTS outlets_update ON outlets;
CREATE POLICY outlets_update ON outlets FOR UPDATE USING (company_id = get_my_company_id() AND get_my_role() = 'super_advisor');

-- USER PROFILES
SELECT drop_policy_if_exists('profiles_select', 'user_profiles');

SELECT drop_policy_if_exists('profiles_own_update', 'user_profiles');

DROP POLICY IF EXISTS profiles_select ON user_profiles;
CREATE POLICY profiles_select ON user_profiles FOR SELECT USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS profiles_own_update ON user_profiles;
CREATE POLICY profiles_own_update ON user_profiles FOR UPDATE USING (id = auth.uid());

-- COST CATEGORIES
SELECT drop_policy_if_exists('cost_cat_select', 'cost_categories');

SELECT drop_policy_if_exists('cost_cat_write', 'cost_categories');

DROP POLICY IF EXISTS cost_cat_select ON cost_categories;
CREATE POLICY cost_cat_select ON cost_categories FOR SELECT USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS cost_cat_write ON cost_categories;
CREATE POLICY cost_cat_write ON cost_categories FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = 'super_advisor');

-- EMPLOYEES
SELECT drop_policy_if_exists('employees_select', 'employees');

SELECT drop_policy_if_exists('employees_write', 'employees');

DROP POLICY IF EXISTS employees_select ON employees;
CREATE POLICY employees_select ON employees FOR SELECT USING (company_id = get_my_company_id() AND (outlet_id IS NULL OR has_outlet_access(outlet_id)));

DROP POLICY IF EXISTS employees_write ON employees;
CREATE POLICY employees_write ON employees FOR ALL USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

-- BUDGETS
SELECT drop_policy_if_exists('budgets_select', 'annual_budgets');

SELECT drop_policy_if_exists('budgets_write', 'annual_budgets');

SELECT drop_policy_if_exists('budget_lines_select', 'budget_cost_lines');

DROP POLICY IF EXISTS budgets_select ON annual_budgets;
CREATE POLICY budgets_select ON annual_budgets FOR SELECT USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS budgets_write ON annual_budgets;
CREATE POLICY budgets_write ON annual_budgets FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = 'super_advisor');

DROP POLICY IF EXISTS budget_lines_select ON budget_cost_lines;
CREATE POLICY budget_lines_select ON budget_cost_lines FOR SELECT USING (EXISTS (SELECT 1 FROM annual_budgets ab WHERE ab.id = budget_id AND ab.company_id = get_my_company_id()));

-- MONTHLY ACTUALS
SELECT drop_policy_if_exists('actuals_select', 'monthly_actuals');

SELECT drop_policy_if_exists('actuals_write', 'monthly_actuals');

SELECT drop_policy_if_exists('cost_lines_select', 'monthly_cost_lines');

SELECT drop_policy_if_exists('cost_lines_write', 'monthly_cost_lines');

DROP POLICY IF EXISTS actuals_select ON monthly_actuals;
CREATE POLICY actuals_select ON monthly_actuals FOR SELECT USING (company_id = get_my_company_id() AND (outlet_id IS NULL OR has_outlet_access(outlet_id)));

DROP POLICY IF EXISTS actuals_write ON monthly_actuals;
CREATE POLICY actuals_write ON monthly_actuals FOR ALL USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile') AND (status != 'chiuso' OR get_my_role() = 'super_advisor'));

DROP POLICY IF EXISTS cost_lines_select ON monthly_cost_lines;
CREATE POLICY cost_lines_select ON monthly_cost_lines FOR SELECT USING (EXISTS (SELECT 1 FROM monthly_actuals ma WHERE ma.id = monthly_actual_id AND ma.company_id = get_my_company_id()));

DROP POLICY IF EXISTS cost_lines_write ON monthly_cost_lines;
CREATE POLICY cost_lines_write ON monthly_cost_lines FOR ALL USING (EXISTS (SELECT 1 FROM monthly_actuals ma WHERE ma.id = monthly_actual_id AND ma.company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile') AND (ma.status != 'chiuso' OR get_my_role() = 'super_advisor')));

-- BANK ACCOUNTS & MOVEMENTS
SELECT drop_policy_if_exists('bank_select', 'bank_accounts');

SELECT drop_policy_if_exists('bank_write', 'bank_accounts');

SELECT drop_policy_if_exists('cash_select', 'cash_movements');

SELECT drop_policy_if_exists('cash_write', 'cash_movements');

SELECT drop_policy_if_exists('balances_select', 'bank_balances');

SELECT drop_policy_if_exists('balances_write', 'bank_balances');

DROP POLICY IF EXISTS bank_select ON bank_accounts;
CREATE POLICY bank_select ON bank_accounts FOR SELECT USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS bank_write ON bank_accounts;
CREATE POLICY bank_write ON bank_accounts FOR ALL USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

DROP POLICY IF EXISTS cash_select ON cash_movements;
CREATE POLICY cash_select ON cash_movements FOR SELECT USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS cash_write ON cash_movements;
CREATE POLICY cash_write ON cash_movements FOR ALL USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

DROP POLICY IF EXISTS balances_select ON bank_balances;
CREATE POLICY balances_select ON bank_balances FOR SELECT USING (EXISTS (SELECT 1 FROM bank_accounts ba WHERE ba.id = bank_account_id AND ba.company_id = get_my_company_id()));

DROP POLICY IF EXISTS balances_write ON bank_balances;
CREATE POLICY balances_write ON bank_balances FOR ALL USING (EXISTS (SELECT 1 FROM bank_accounts ba WHERE ba.id = bank_account_id AND ba.company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile')));

-- DAILY REVENUE
SELECT drop_policy_if_exists('revenue_select', 'daily_revenue');

SELECT drop_policy_if_exists('revenue_write', 'daily_revenue');

DROP POLICY IF EXISTS revenue_select ON daily_revenue;
CREATE POLICY revenue_select ON daily_revenue FOR SELECT USING (company_id = get_my_company_id() AND has_outlet_access(outlet_id));

DROP POLICY IF EXISTS revenue_write ON daily_revenue;
CREATE POLICY revenue_write ON daily_revenue FOR ALL USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

-- LOANS
SELECT drop_policy_if_exists('loans_select', 'loans');

SELECT drop_policy_if_exists('loans_write', 'loans');

DROP POLICY IF EXISTS loans_select ON loans;
CREATE POLICY loans_select ON loans FOR SELECT USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS loans_write ON loans;
CREATE POLICY loans_write ON loans FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = 'super_advisor');

-- IMPORTS
SELECT drop_policy_if_exists('imports_select', 'import_batches');

SELECT drop_policy_if_exists('imports_write', 'import_batches');

DROP POLICY IF EXISTS imports_select ON import_batches;
CREATE POLICY imports_select ON import_batches FOR SELECT USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

DROP POLICY IF EXISTS imports_write ON import_batches;
CREATE POLICY imports_write ON import_batches FOR ALL USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

-- INVOICES & RECEIPTS
SELECT drop_policy_if_exists('invoices_select', 'electronic_invoices');

SELECT drop_policy_if_exists('invoices_write', 'electronic_invoices');

SELECT drop_policy_if_exists('receipts_select', 'daily_receipts_ade');

SELECT drop_policy_if_exists('receipts_write', 'daily_receipts_ade');

DROP POLICY IF EXISTS invoices_select ON electronic_invoices;
CREATE POLICY invoices_select ON electronic_invoices FOR SELECT USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS invoices_write ON electronic_invoices;
CREATE POLICY invoices_write ON electronic_invoices FOR ALL USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

DROP POLICY IF EXISTS receipts_select ON daily_receipts_ade;
CREATE POLICY receipts_select ON daily_receipts_ade FOR SELECT USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS receipts_write ON daily_receipts_ade;
CREATE POLICY receipts_write ON daily_receipts_ade FOR ALL USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

-- SUPPLIERS
SELECT drop_policy_if_exists('suppliers_select', 'suppliers');

SELECT drop_policy_if_exists('suppliers_write', 'suppliers');

DROP POLICY IF EXISTS suppliers_select ON suppliers;
CREATE POLICY suppliers_select ON suppliers FOR SELECT USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS suppliers_write ON suppliers;
CREATE POLICY suppliers_write ON suppliers FOR ALL USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

-- CONTRACTS
SELECT drop_policy_if_exists('contracts_select', 'contracts');

SELECT drop_policy_if_exists('contracts_write', 'contracts');

SELECT drop_policy_if_exists('deadlines_select', 'contract_deadlines');

SELECT drop_policy_if_exists('amount_history_select', 'contract_amount_history');

DROP POLICY IF EXISTS contracts_select ON contracts;
CREATE POLICY contracts_select ON contracts FOR SELECT USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS contracts_write ON contracts;
CREATE POLICY contracts_write ON contracts FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = 'super_advisor');

DROP POLICY IF EXISTS deadlines_select ON contract_deadlines;
CREATE POLICY deadlines_select ON contract_deadlines FOR SELECT USING (EXISTS (SELECT 1 FROM contracts c WHERE c.id = contract_id AND c.company_id = get_my_company_id()));

DROP POLICY IF EXISTS amount_history_select ON contract_amount_history;
CREATE POLICY amount_history_select ON contract_amount_history FOR SELECT USING (EXISTS (SELECT 1 FROM contracts c WHERE c.id = contract_id AND c.company_id = get_my_company_id()));

-- PAYABLES
SELECT drop_policy_if_exists('payables_select', 'payables');

SELECT drop_policy_if_exists('payables_write', 'payables');

SELECT drop_policy_if_exists('payment_records_select', 'payment_records');

SELECT drop_policy_if_exists('payment_records_write', 'payment_records');

SELECT drop_policy_if_exists('actions_select', 'payable_actions');

SELECT drop_policy_if_exists('actions_write', 'payable_actions');

DROP POLICY IF EXISTS payables_select ON payables;
CREATE POLICY payables_select ON payables FOR SELECT USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS payables_write ON payables;
CREATE POLICY payables_write ON payables FOR ALL USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

DROP POLICY IF EXISTS payment_records_select ON payment_records;
CREATE POLICY payment_records_select ON payment_records FOR SELECT USING (EXISTS (SELECT 1 FROM payables p WHERE p.id = payable_id AND p.company_id = get_my_company_id()));

DROP POLICY IF EXISTS payment_records_write ON payment_records;
CREATE POLICY payment_records_write ON payment_records FOR ALL USING (EXISTS (SELECT 1 FROM payables p WHERE p.id = payable_id AND p.company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile')));

DROP POLICY IF EXISTS actions_select ON payable_actions;
CREATE POLICY actions_select ON payable_actions FOR SELECT USING (EXISTS (SELECT 1 FROM payables p WHERE p.id = payable_id AND p.company_id = get_my_company_id()));

DROP POLICY IF EXISTS actions_write ON payable_actions;
CREATE POLICY actions_write ON payable_actions FOR ALL USING (EXISTS (SELECT 1 FROM payables p WHERE p.id = payable_id AND p.company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile')));

-- CASH BUDGET
SELECT drop_policy_if_exists('cash_budget_select', 'cash_budget');

SELECT drop_policy_if_exists('cash_budget_write', 'cash_budget');

DROP POLICY IF EXISTS cash_budget_select ON cash_budget;
CREATE POLICY cash_budget_select ON cash_budget FOR SELECT USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS cash_budget_write ON cash_budget;
CREATE POLICY cash_budget_write ON cash_budget FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = 'super_advisor');

-- CSV MAPPINGS
SELECT drop_policy_if_exists('csv_select', 'csv_mappings');

SELECT drop_policy_if_exists('csv_write', 'csv_mappings');

DROP POLICY IF EXISTS csv_select ON csv_mappings;
CREATE POLICY csv_select ON csv_mappings FOR SELECT USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS csv_write ON csv_mappings;
CREATE POLICY csv_write ON csv_mappings FOR ALL USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

-- JUNCTION TABLES
SELECT drop_policy_if_exists('outlet_banks_select', 'outlet_bank_accounts');

SELECT drop_policy_if_exists('outlet_banks_write', 'outlet_bank_accounts');

SELECT drop_policy_if_exists('outlet_suppliers_select', 'outlet_suppliers');

SELECT drop_policy_if_exists('outlet_suppliers_write', 'outlet_suppliers');

SELECT drop_policy_if_exists('outlet_costs_select', 'outlet_cost_template');

SELECT drop_policy_if_exists('outlet_costs_write', 'outlet_cost_template');

DROP POLICY IF EXISTS outlet_banks_select ON outlet_bank_accounts;
CREATE POLICY outlet_banks_select ON outlet_bank_accounts FOR SELECT USING (has_outlet_access(outlet_id));

DROP POLICY IF EXISTS outlet_banks_write ON outlet_bank_accounts;
CREATE POLICY outlet_banks_write ON outlet_bank_accounts FOR ALL USING (get_my_role() = 'super_advisor');

DROP POLICY IF EXISTS outlet_suppliers_select ON outlet_suppliers;
CREATE POLICY outlet_suppliers_select ON outlet_suppliers FOR SELECT USING (has_outlet_access(outlet_id));

DROP POLICY IF EXISTS outlet_suppliers_write ON outlet_suppliers;
CREATE POLICY outlet_suppliers_write ON outlet_suppliers FOR ALL USING (get_my_role() = 'super_advisor');

DROP POLICY IF EXISTS outlet_costs_select ON outlet_cost_template;
CREATE POLICY outlet_costs_select ON outlet_cost_template FOR SELECT USING (has_outlet_access(outlet_id));

DROP POLICY IF EXISTS outlet_costs_write ON outlet_cost_template;
CREATE POLICY outlet_costs_write ON outlet_cost_template FOR ALL USING (get_my_role() = 'super_advisor');

-- OUTLET ATTACHMENTS
SELECT drop_policy_if_exists('attachments_select', 'outlet_attachments');

SELECT drop_policy_if_exists('attachments_write', 'outlet_attachments');

DROP POLICY IF EXISTS attachments_select ON outlet_attachments;
CREATE POLICY attachments_select ON outlet_attachments FOR SELECT USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS attachments_write ON outlet_attachments;
CREATE POLICY attachments_write ON outlet_attachments FOR ALL USING (company_id = get_my_company_id() AND get_my_role() IN ('super_advisor', 'contabile'));

-- LOAN TRANCHES
SELECT drop_policy_if_exists('tranches_select', 'loan_tranches');

SELECT drop_policy_if_exists('tranches_write', 'loan_tranches');

DROP POLICY IF EXISTS tranches_select ON loan_tranches;
CREATE POLICY tranches_select ON loan_tranches FOR SELECT USING (EXISTS (SELECT 1 FROM loans l WHERE l.id = loan_id AND l.company_id = get_my_company_id()));

DROP POLICY IF EXISTS tranches_write ON loan_tranches;
CREATE POLICY tranches_write ON loan_tranches FOR ALL USING (EXISTS (SELECT 1 FROM loans l WHERE l.id = loan_id AND l.company_id = get_my_company_id() AND get_my_role() = 'super_advisor'));

-- Pulizia funzione helper temporanea
DROP FUNCTION IF EXISTS drop_policy_if_exists(TEXT, TEXT);

-- ============================================================
-- FATTO!
-- ============================================================
-- Questo script crea tutte le tabelle, enum, trigger, indici,
-- funzioni e RLS policies necessarie per il Gestionale NZ.
-- Sicuro da ri-eseguire: usa IF NOT EXISTS e gestisce duplicati.
-- ============================================================;

-- ─── source: 010_fix_missing_columns.sql ─────────────────────────────────

-- ============================================================
-- GESTIONALE NZ — Fix colonne mancanti su tabelle esistenti
-- Aggiunge colonne che IF NOT EXISTS non riesce ad aggiungere
-- su tabelle create in precedenza con schema parziale
-- ============================================================

-- ============================================================
-- import_batches: colonne mancanti
-- ============================================================
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS imported_by UUID REFERENCES user_profiles(id);

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS file_name TEXT;

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS file_path TEXT;

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS bank_account_id UUID;

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS outlet_id UUID;

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS period_from DATE;

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS period_to DATE;

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS rows_total INTEGER DEFAULT 0;

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS rows_imported INTEGER DEFAULT 0;

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS rows_skipped INTEGER DEFAULT 0;

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS rows_error INTEGER DEFAULT 0;

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS error_log JSONB;

-- Colonne usate dal frontend (alias / colonne extra)
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS total_rows INTEGER DEFAULT 0;

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS processed_rows INTEGER DEFAULT 0;

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS error_rows INTEGER DEFAULT 0;

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS notes TEXT;

-- ============================================================
-- companies: colonne mancanti
-- ============================================================
ALTER TABLE companies ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE companies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_number TEXT;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS fiscal_code TEXT;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS legal_address TEXT;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS pec TEXT;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS sdi_code TEXT;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS notes TEXT;

-- ============================================================
-- outlets: colonne mancanti (dalla 007 + base)
-- ============================================================
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS closing_date DATE;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS outlet_type TEXT DEFAULT 'outlet';

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS mall_name TEXT;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS mall_manager TEXT;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS target_revenue_year1 NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS target_revenue_year2 NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS target_revenue_steady NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS target_margin_pct NUMERIC(5,2) DEFAULT 60;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS target_cogs_pct NUMERIC(5,2) DEFAULT 40;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS min_revenue_target NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS min_revenue_period TEXT;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rent_monthly NUMERIC(12,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS condo_marketing_monthly NUMERIC(12,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS staff_budget_monthly NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS admin_cost_monthly NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS setup_cost NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS bp_status TEXT DEFAULT 'bozza';

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS photo_url TEXT;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS notes TEXT;

-- Campi contratto (007)
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS sell_sqm NUMERIC(10,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS unit_code TEXT;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS brand TEXT;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS concedente TEXT;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS contract_start DATE;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS contract_end DATE;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS contract_duration_months INTEGER;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS contract_min_months INTEGER;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS delivery_date DATE;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS opening_confirmed BOOLEAN DEFAULT FALSE;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rent_annual NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rent_per_sqm NUMERIC(10,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rent_free_days INTEGER DEFAULT 0;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS variable_rent_pct NUMERIC(5,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS deposit_guarantee NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS advance_payment NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rent_year2_annual NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rent_year3_annual NUMERIC(14,2);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS exit_clause_month INTEGER;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS exit_revenue_threshold NUMERIC(14,2);

-- ============================================================
-- user_profiles: colonne mancanti
-- ============================================================
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS first_name TEXT;

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_name TEXT;

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- ============================================================
-- employees: colonne mancanti
-- ============================================================
ALTER TABLE employees ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE employees ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE employees ADD COLUMN IF NOT EXISTS fiscal_code TEXT;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS hire_date DATE;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_date DATE;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS level TEXT;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS weekly_hours NUMERIC(5,1);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS fte_ratio NUMERIC(4,2);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS gross_monthly_cost NUMERIC(12,2);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS gross_annual_cost NUMERIC(14,2);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS net_monthly_salary NUMERIC(12,2);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS role_description TEXT;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS notes TEXT;

-- ============================================================
-- bank_accounts: colonne mancanti
-- ============================================================
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS iban TEXT;

ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS account_name TEXT;

ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'conto_corrente';

ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS credit_line NUMERIC(14,2) DEFAULT 0;

ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'EUR';

ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS outlet_id UUID;

ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- ============================================================
-- suppliers: colonne mancanti
-- ============================================================
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS fiscal_code TEXT;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS iban TEXT;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- ============================================================
-- contracts: colonne mancanti
-- ============================================================
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_number TEXT;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2) DEFAULT 22;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(14,2);

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS renewal_date DATE;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS notice_days INTEGER DEFAULT 180;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS notice_deadline DATE;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS auto_renewal BOOLEAN DEFAULT TRUE;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS renewal_period_months INTEGER DEFAULT 12;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS escalation_type TEXT;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS escalation_rate NUMERIC(6,4);

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS escalation_date DATE;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS escalation_frequency_months INTEGER DEFAULT 12;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS min_revenue_clause NUMERIC(14,2);

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS min_revenue_period TEXT;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS variable_rent_pct NUMERIC(5,4);

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS variable_rent_threshold NUMERIC(14,2);

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS sqm NUMERIC(10,2);

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS notes TEXT;

-- ============================================================
-- cash_movements: colonne mancanti
-- ============================================================
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS value_date DATE;

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS balance_after NUMERIC(14,2);

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS counterpart TEXT;

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS is_reconciled BOOLEAN DEFAULT FALSE;

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS reconciled_with UUID;

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS reconciled_by UUID;

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS import_batch_id UUID;

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS notes TEXT;

-- ============================================================
-- payables: colonne mancanti
-- ============================================================
ALTER TABLE payables ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE payables ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE payables ADD COLUMN IF NOT EXISTS original_due_date DATE;

ALTER TABLE payables ADD COLUMN IF NOT EXISTS postponed_to DATE;

ALTER TABLE payables ADD COLUMN IF NOT EXISTS postpone_count INTEGER DEFAULT 0;

ALTER TABLE payables ADD COLUMN IF NOT EXISTS amount_remaining NUMERIC(14,2);

ALTER TABLE payables ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;

ALTER TABLE payables ADD COLUMN IF NOT EXISTS suspend_reason TEXT;

ALTER TABLE payables ADD COLUMN IF NOT EXISTS suspend_date DATE;

ALTER TABLE payables ADD COLUMN IF NOT EXISTS resolved_date DATE;

ALTER TABLE payables ADD COLUMN IF NOT EXISTS resolved_by UUID;

ALTER TABLE payables ADD COLUMN IF NOT EXISTS electronic_invoice_id UUID;

ALTER TABLE payables ADD COLUMN IF NOT EXISTS import_batch_id UUID;

ALTER TABLE payables ADD COLUMN IF NOT EXISTS payment_date DATE;

ALTER TABLE payables ADD COLUMN IF NOT EXISTS payment_bank_account_id UUID;

ALTER TABLE payables ADD COLUMN IF NOT EXISTS cash_movement_id UUID;

ALTER TABLE payables ADD COLUMN IF NOT EXISTS notes TEXT;

-- ============================================================
-- outlet_attachments: colonne mancanti
-- ============================================================
ALTER TABLE outlet_attachments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE outlet_attachments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE outlet_attachments ADD COLUMN IF NOT EXISTS file_name TEXT;

ALTER TABLE outlet_attachments ADD COLUMN IF NOT EXISTS file_path TEXT;

ALTER TABLE outlet_attachments ADD COLUMN IF NOT EXISTS file_size INTEGER;

ALTER TABLE outlet_attachments ADD COLUMN IF NOT EXISTS mime_type TEXT;

ALTER TABLE outlet_attachments ADD COLUMN IF NOT EXISTS is_required BOOLEAN DEFAULT FALSE;

ALTER TABLE outlet_attachments ADD COLUMN IF NOT EXISTS is_uploaded BOOLEAN DEFAULT FALSE;

ALTER TABLE outlet_attachments ADD COLUMN IF NOT EXISTS extracted_data JSONB;

ALTER TABLE outlet_attachments ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE outlet_attachments ADD COLUMN IF NOT EXISTS uploaded_by UUID;

ALTER TABLE outlet_attachments ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ;

-- ============================================================
-- FATTO! Tutte le colonne mancanti sono state aggiunte.
-- ============================================================;

-- ─── source: 012_fix_delete_policies.sql ─────────────────────────────────

-- ============================================================
-- FIX: Aggiunge policy DELETE per outlets e outlet_attachments
-- Le RLS policies esistenti probabilmente hanno solo SELECT/INSERT/UPDATE
-- ============================================================

-- Policy DELETE per outlets
DROP POLICY IF EXISTS "outlets_delete" ON outlets;

DROP POLICY IF EXISTS "outlets_delete" ON outlets;
CREATE POLICY "outlets_delete" ON outlets
  FOR DELETE
  USING (true);

-- Policy DELETE per outlet_attachments
DROP POLICY IF EXISTS "outlet_attachments_delete" ON outlet_attachments;

DROP POLICY IF EXISTS "outlet_attachments_delete" ON outlet_attachments;
CREATE POLICY "outlet_attachments_delete" ON outlet_attachments
  FOR DELETE
  USING (true);

-- Policy UPDATE per employees (per sganciare dipendenti dall'outlet)
DROP POLICY IF EXISTS "employees_update" ON employees;

DROP POLICY IF EXISTS "employees_update" ON employees;
CREATE POLICY "employees_update" ON employees
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Verifica
SELECT tablename, policyname, cmd FROM pg_policies
WHERE tablename IN ('outlets', 'outlet_attachments', 'employees')
ORDER BY tablename, cmd;

-- ─── source: 013_add_yapily_columns_to_bank_transactions.sql ─────────────

-- Migrazione 013: Aggiunge colonne Yapily alla tabella bank_transactions esistente
-- Data: 2026-04-21
-- Contesto: La tabella bank_transactions esisteva già ma senza colonne specifiche per Yapily.
--           Questa migrazione aggiunge i campi necessari per sincronizzare transazioni da Open Banking.
-- NOTA: Eseguita su Supabase live il 21/04/2026

BEGIN;

-- Colonne per collegamento account Yapily
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES yapily_accounts(id);

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS yapily_transaction_id TEXT;

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'EUR';

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS transaction_type TEXT;

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS running_balance NUMERIC(15,2);

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS merchant_name TEXT;

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'BOOKED';

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS booking_date DATE;

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS raw_data JSONB;

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS reconciled_invoice_id UUID;

-- Indice di deduplicazione per evitare transazioni duplicate da Yapily
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_transactions_yapily_dedup
  ON bank_transactions(company_id, yapily_transaction_id)
  WHERE yapily_transaction_id IS NOT NULL;

-- Indici per query frequenti
CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_id ON bank_transactions(account_id);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_booking_date ON bank_transactions(booking_date);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_reconciled ON bank_transactions(reconciled_invoice_id) WHERE reconciled_invoice_id IS NOT NULL;

COMMIT;

-- ─── source: 014_create_supplier_allocation_tables.sql ───────────────────

-- Migrazione 014: Crea tabelle per allocazione fornitori agli outlet
-- Data: 2026-04-21
-- Contesto: Sistema di divisione costi fornitori tra i 7 outlet con 4 modalità:
--           DIRETTO (100% a un outlet), SPLIT_PCT (percentuali),
--           SPLIT_VALORE (importi fissi), QUOTE_UGUALI (distribuzione equa)
-- NOTA: Eseguita su Supabase live il 21/04/2026

BEGIN;

-- Tabella regole di allocazione (una per fornitore attivo)
CREATE TABLE IF NOT EXISTS supplier_allocation_rules (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID NOT NULL,
    supplier_id UUID REFERENCES suppliers(id) NOT NULL,
    allocation_mode TEXT NOT NULL CHECK (allocation_mode IN ('DIRETTO', 'SPLIT_PCT', 'SPLIT_VALORE', 'QUOTE_UGUALI')),
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID,
    -- Un solo set di regole attive per fornitore per azienda
    UNIQUE(company_id, supplier_id, is_active)
);

-- Tabella dettagli allocazione (outlet + percentuale/valore per ogni regola)
CREATE TABLE IF NOT EXISTS supplier_allocation_details (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    rule_id UUID REFERENCES supplier_allocation_rules(id) ON DELETE CASCADE NOT NULL,
    outlet_id UUID REFERENCES outlets(id) NOT NULL,
    percentage NUMERIC(5,2),
    fixed_value NUMERIC(15,2),
    created_at TIMESTAMPTZ DEFAULT now(),
    -- Un outlet per regola
    UNIQUE(rule_id, outlet_id)
);

-- RLS: supplier_allocation_rules
ALTER TABLE supplier_allocation_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "supplier_allocation_rules_select" ON supplier_allocation_rules;
CREATE POLICY "supplier_allocation_rules_select" ON supplier_allocation_rules
    FOR SELECT USING (
        company_id IN (
            SELECT company_id FROM user_profiles WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "supplier_allocation_rules_insert" ON supplier_allocation_rules;
CREATE POLICY "supplier_allocation_rules_insert" ON supplier_allocation_rules
    FOR INSERT WITH CHECK (
        company_id IN (
            SELECT company_id FROM user_profiles WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "supplier_allocation_rules_update" ON supplier_allocation_rules;
CREATE POLICY "supplier_allocation_rules_update" ON supplier_allocation_rules
    FOR UPDATE USING (
        company_id IN (
            SELECT company_id FROM user_profiles WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "supplier_allocation_rules_delete" ON supplier_allocation_rules;
CREATE POLICY "supplier_allocation_rules_delete" ON supplier_allocation_rules
    FOR DELETE USING (
        company_id IN (
            SELECT company_id FROM user_profiles WHERE user_id = auth.uid()
        )
    );

-- RLS: supplier_allocation_details (via rule_id → company_id)
ALTER TABLE supplier_allocation_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "supplier_allocation_details_select" ON supplier_allocation_details;
CREATE POLICY "supplier_allocation_details_select" ON supplier_allocation_details
    FOR SELECT USING (
        rule_id IN (
            SELECT r.id FROM supplier_allocation_rules r
            JOIN user_profiles up ON up.company_id = r.company_id
            WHERE up.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "supplier_allocation_details_insert" ON supplier_allocation_details;
CREATE POLICY "supplier_allocation_details_insert" ON supplier_allocation_details
    FOR INSERT WITH CHECK (
        rule_id IN (
            SELECT r.id FROM supplier_allocation_rules r
            JOIN user_profiles up ON up.company_id = r.company_id
            WHERE up.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "supplier_allocation_details_update" ON supplier_allocation_details;
CREATE POLICY "supplier_allocation_details_update" ON supplier_allocation_details
    FOR UPDATE USING (
        rule_id IN (
            SELECT r.id FROM supplier_allocation_rules r
            JOIN user_profiles up ON up.company_id = r.company_id
            WHERE up.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "supplier_allocation_details_delete" ON supplier_allocation_details;
CREATE POLICY "supplier_allocation_details_delete" ON supplier_allocation_details
    FOR DELETE USING (
        rule_id IN (
            SELECT r.id FROM supplier_allocation_rules r
            JOIN user_profiles up ON up.company_id = r.company_id
            WHERE up.user_id = auth.uid()
        )
    );

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_supplier_alloc_rules_company ON supplier_allocation_rules(company_id);

CREATE INDEX IF NOT EXISTS idx_supplier_alloc_rules_supplier ON supplier_allocation_rules(supplier_id);

CREATE INDEX IF NOT EXISTS idx_supplier_alloc_rules_active ON supplier_allocation_rules(company_id, is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_supplier_alloc_details_rule ON supplier_allocation_details(rule_id);

COMMIT;

-- ─── source: 015_add_sdi_id_unique_index.sql ─────────────────────────────

-- Migrazione 015: Aggiunge indice univoco su sdi_id per supportare UPSERT webhook SDI
-- Data: 2026-04-21
-- Contesto: L'indice idx_electronic_invoices_sdi_id esistente NON è univoco.
--           Per l'UPSERT nella Edge Function sdi-receive serve un constraint univoco
--           su (company_id, sdi_id) per evitare duplicati quando il SDI reinvia la stessa fattura.
-- NOTA: Eseguita su Supabase live il 21/04/2026

CREATE UNIQUE INDEX IF NOT EXISTS idx_electronic_invoices_sdi_id_unique
  ON electronic_invoices(company_id, sdi_id)
  WHERE sdi_id IS NOT NULL;

-- ─── source: 017_create_sdi_sync_log.sql ─────────────────────────────────

-- Migrazione 017: Tabella sdi_sync_log
-- Data: 2026-04-22
-- Contesto: Log di ogni esecuzione sync SDI (manuale o scheduled).
--           Permette di monitorare stato, errori, e performance delle sincronizzazioni
--           fatture/corrispettivi con Agenzia delle Entrate.

BEGIN;

CREATE TABLE IF NOT EXISTS sdi_sync_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  trigger       text NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
  triggered_by  text,                     -- email utente o 'cron_6h'
  date_from     date,
  date_to       date,
  fatture_count integer DEFAULT 0,
  corrispettivi_count integer DEFAULT 0,
  errors        jsonb,                    -- array di stringhe errore, null se nessun errore
  duration_ms   integer,
  status        text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'partial', 'error')),
  created_at    timestamptz DEFAULT now()
);

-- Indice per query recenti per company
CREATE INDEX IF NOT EXISTS idx_sdi_sync_log_company_created
  ON sdi_sync_log (company_id, created_at DESC);

-- RLS
ALTER TABLE sdi_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sdi_sync_log_select_own_company" ON sdi_sync_log;
-- Policy: utenti autenticati vedono solo i log della propria company
CREATE POLICY "sdi_sync_log_select_own_company"
  ON sdi_sync_log FOR SELECT
  USING (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid);

-- Policy: insert via service_role (le Netlify Functions usano service_role key)
-- Non serve policy INSERT per utenti normali — solo il backend inserisce

COMMIT;

-- Post-migration verification:
-- SELECT COUNT(*) FROM sdi_sync_log; -- 0 (tabella appena creata)
-- \d sdi_sync_log  -- verifica struttura;
