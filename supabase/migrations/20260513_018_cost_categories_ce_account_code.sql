-- Migrazione 018 — collega cost_categories al piano dei conti CE.
-- ce_account_code è un soft-FK testuale a chart_of_accounts.code livello 3.
-- Quando una fattura passiva è categorizzata in una cost_category,
-- la RPC refresh_budget_consuntivo userà ce_account_code per aggregare
-- l'importo nei budget_entries con account_code uguale.
ALTER TABLE cost_categories
  ADD COLUMN IF NOT EXISTS ce_account_code text;

COMMENT ON COLUMN cost_categories.ce_account_code IS
  'Codice del piano dei conti CE (chart_of_accounts.code livello 3, es. 610134, 670103). Usato dalla RPC refresh_budget_consuntivo per aggregare le fatture passive nelle voci di budget_entries.';

CREATE INDEX IF NOT EXISTS idx_cost_categories_ce_account_code
  ON cost_categories(company_id, ce_account_code);
