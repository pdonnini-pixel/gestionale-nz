-- ============================================================
-- FIX COMPLETO: Adatta TUTTE le tabelle esistenti
-- Esegui QUESTO per primo, poi ri-esegui supabase_DEFINITIVO.sql
-- ============================================================

-- ========================================
-- 1. FIX BANK_ACCOUNTS
-- Esistente: bank_name, iban, account_name, account_type, credit_line, currency, outlet_id, is_active
-- Mancanti: current_balance, last_update, outlet_code, note, updated_at
-- ========================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bank_accounts' AND column_name='current_balance') THEN
    ALTER TABLE bank_accounts ADD COLUMN current_balance NUMERIC(14,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bank_accounts' AND column_name='last_update') THEN
    ALTER TABLE bank_accounts ADD COLUMN last_update TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bank_accounts' AND column_name='outlet_code') THEN
    ALTER TABLE bank_accounts ADD COLUMN outlet_code TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bank_accounts' AND column_name='note') THEN
    ALTER TABLE bank_accounts ADD COLUMN note TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bank_accounts' AND column_name='updated_at') THEN
    ALTER TABLE bank_accounts ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

-- ========================================
-- 2. FIX LOANS
-- Esistente: description, total_amount, interest_rate, start_date, end_date, notes
-- Mancanti: lender, loan_type, original_amount, remaining_amount, installment_amount,
--           installment_frequency, bank_account_id, beneficiaries, note, is_active, updated_at
-- ========================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='lender') THEN
    ALTER TABLE loans ADD COLUMN lender TEXT;
    -- Copia da description come fallback
    UPDATE loans SET lender = description WHERE lender IS NULL AND description IS NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='loan_type') THEN
    ALTER TABLE loans ADD COLUMN loan_type TEXT DEFAULT 'altro';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='original_amount') THEN
    ALTER TABLE loans ADD COLUMN original_amount NUMERIC(14,2);
    UPDATE loans SET original_amount = total_amount WHERE original_amount IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='remaining_amount') THEN
    ALTER TABLE loans ADD COLUMN remaining_amount NUMERIC(14,2);
    UPDATE loans SET remaining_amount = total_amount WHERE remaining_amount IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='installment_amount') THEN
    ALTER TABLE loans ADD COLUMN installment_amount NUMERIC(14,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='installment_frequency') THEN
    ALTER TABLE loans ADD COLUMN installment_frequency TEXT DEFAULT 'mensile';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='bank_account_id') THEN
    ALTER TABLE loans ADD COLUMN bank_account_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='beneficiaries') THEN
    ALTER TABLE loans ADD COLUMN beneficiaries JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='note') THEN
    ALTER TABLE loans ADD COLUMN note TEXT;
    UPDATE loans SET note = notes WHERE note IS NULL AND notes IS NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='is_active') THEN
    ALTER TABLE loans ADD COLUMN is_active BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='updated_at') THEN
    ALTER TABLE loans ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

-- Assicurati che lender non sia NULL (necessario per INSERT)
UPDATE loans SET lender = COALESCE(lender, description, 'N/D') WHERE lender IS NULL;

-- ========================================
-- 3. FIX SUPPLIERS
-- Esistente: name, vat_number, fiscal_code, iban, default_payment_terms, default_payment_method, category, notes, is_active
-- Mancanti: ragione_sociale, partita_iva, codice_fiscale, codice_sdi, pec, indirizzo, citta, provincia, cap,
--           telefono, email, payment_terms, payment_method, cost_center, note
-- ========================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='ragione_sociale') THEN
    ALTER TABLE suppliers ADD COLUMN ragione_sociale TEXT;
    UPDATE suppliers SET ragione_sociale = name WHERE ragione_sociale IS NULL AND name IS NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='partita_iva') THEN
    ALTER TABLE suppliers ADD COLUMN partita_iva TEXT;
    UPDATE suppliers SET partita_iva = vat_number WHERE partita_iva IS NULL AND vat_number IS NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='codice_fiscale') THEN
    ALTER TABLE suppliers ADD COLUMN codice_fiscale TEXT;
    UPDATE suppliers SET codice_fiscale = fiscal_code WHERE codice_fiscale IS NULL AND fiscal_code IS NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='codice_sdi') THEN
    ALTER TABLE suppliers ADD COLUMN codice_sdi TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='pec') THEN
    ALTER TABLE suppliers ADD COLUMN pec TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='indirizzo') THEN
    ALTER TABLE suppliers ADD COLUMN indirizzo TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='citta') THEN
    ALTER TABLE suppliers ADD COLUMN citta TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='provincia') THEN
    ALTER TABLE suppliers ADD COLUMN provincia TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='cap') THEN
    ALTER TABLE suppliers ADD COLUMN cap TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='telefono') THEN
    ALTER TABLE suppliers ADD COLUMN telefono TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='email') THEN
    ALTER TABLE suppliers ADD COLUMN email TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='payment_terms') THEN
    ALTER TABLE suppliers ADD COLUMN payment_terms INT DEFAULT 30;
    UPDATE suppliers SET payment_terms = default_payment_terms WHERE payment_terms IS NULL OR payment_terms = 30;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='payment_method') THEN
    ALTER TABLE suppliers ADD COLUMN payment_method TEXT DEFAULT 'bonifico';
    UPDATE suppliers SET payment_method = default_payment_method::text WHERE payment_method IS NULL OR payment_method = 'bonifico';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='cost_center') THEN
    ALTER TABLE suppliers ADD COLUMN cost_center TEXT DEFAULT 'all';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='note') THEN
    ALTER TABLE suppliers ADD COLUMN note TEXT;
    UPDATE suppliers SET note = notes WHERE note IS NULL AND notes IS NOT NULL;
  END IF;
END $$;

-- Assicura che ragione_sociale non sia NULL
UPDATE suppliers SET ragione_sociale = COALESCE(ragione_sociale, name, 'N/D') WHERE ragione_sociale IS NULL;

-- ========================================
-- 4. DROP VISTE VECCHIE (per evitare conflitti al recreate)
-- ========================================
DROP VIEW IF EXISTS v_payment_schedule CASCADE;
DROP VIEW IF EXISTS v_employee_costs_by_outlet CASCADE;
DROP VIEW IF EXISTS v_budget_variance CASCADE;
DROP VIEW IF EXISTS v_profit_and_loss CASCADE;

-- ========================================
-- 5. VERIFICA
-- ========================================
SELECT 'bank_accounts' AS tabella, count(*) AS colonne FROM information_schema.columns WHERE table_name='bank_accounts'
UNION ALL
SELECT 'loans', count(*) FROM information_schema.columns WHERE table_name='loans'
UNION ALL
SELECT 'suppliers', count(*) FROM information_schema.columns WHERE table_name='suppliers'
UNION ALL
SELECT 'employees', count(*) FROM information_schema.columns WHERE table_name='employees';
