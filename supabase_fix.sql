-- ============================================================
-- FIX: Aggiunge colonne mancanti a tabelle già esistenti
-- e ricrea le viste. Eseguire DOPO il file principale.
-- ============================================================

-- Fix suppliers: aggiungi colonne mancanti
DO $$
BEGIN
  -- suppliers
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='partita_iva') THEN
    ALTER TABLE suppliers ADD COLUMN partita_iva TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='codice_fiscale') THEN
    ALTER TABLE suppliers ADD COLUMN codice_fiscale TEXT;
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
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='iban') THEN
    ALTER TABLE suppliers ADD COLUMN iban TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='payment_terms') THEN
    ALTER TABLE suppliers ADD COLUMN payment_terms INT DEFAULT 30;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='payment_method') THEN
    ALTER TABLE suppliers ADD COLUMN payment_method TEXT DEFAULT 'bonifico';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='category') THEN
    ALTER TABLE suppliers ADD COLUMN category TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='cost_center') THEN
    ALTER TABLE suppliers ADD COLUMN cost_center TEXT DEFAULT 'all';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='is_active') THEN
    ALTER TABLE suppliers ADD COLUMN is_active BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='note') THEN
    ALTER TABLE suppliers ADD COLUMN note TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='ragione_sociale') THEN
    ALTER TABLE suppliers ADD COLUMN ragione_sociale TEXT;
  END IF;

  -- bank_accounts: aggiungi colonne mancanti
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bank_accounts' AND column_name='outlet_code') THEN
    ALTER TABLE bank_accounts ADD COLUMN outlet_code TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bank_accounts' AND column_name='last_update') THEN
    ALTER TABLE bank_accounts ADD COLUMN last_update TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bank_accounts' AND column_name='account_type') THEN
    ALTER TABLE bank_accounts ADD COLUMN account_type TEXT DEFAULT 'conto_corrente';
  END IF;

  -- invoices: aggiungi colonne mancanti
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='account_code') THEN
    ALTER TABLE invoices ADD COLUMN account_code TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='cost_center') THEN
    ALTER TABLE invoices ADD COLUMN cost_center TEXT DEFAULT 'all';
  END IF;

  -- payment_schedule: aggiungi colonne mancanti
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_schedule' AND column_name='bank_account_id') THEN
    ALTER TABLE payment_schedule ADD COLUMN bank_account_id UUID;
  END IF;

END $$;

-- Ricrea indice suppliers se mancante
CREATE INDEX IF NOT EXISTS idx_suppliers_piva ON suppliers(partita_iva);

-- ============================================================
-- RICREA TUTTE LE VISTE (DROP + CREATE per aggiornare)
-- ============================================================

DROP VIEW IF EXISTS v_payment_schedule CASCADE;
DROP VIEW IF EXISTS v_employee_costs_by_outlet CASCADE;
DROP VIEW IF EXISTS v_budget_variance CASCADE;
DROP VIEW IF EXISTS v_profit_and_loss CASCADE;

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
-- RLS policies per tabelle che potrebbero mancarle
-- ============================================================
DO $$
BEGIN
  -- suppliers RLS
  ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
  EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Auth read suppliers" ON suppliers FOR SELECT TO authenticated USING (true);
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "Auth insert suppliers" ON suppliers FOR INSERT TO authenticated WITH CHECK (true);
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "Auth update suppliers" ON suppliers FOR UPDATE TO authenticated USING (true);
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "Auth delete suppliers" ON suppliers FOR DELETE TO authenticated USING (true);
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- DONE
-- ============================================================
SELECT 'Fix completato con successo!' AS risultato;
