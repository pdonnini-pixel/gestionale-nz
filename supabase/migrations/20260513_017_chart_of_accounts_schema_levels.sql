-- Migrazione 017 — schema chart_of_accounts: gerarchia + sezione CE
-- Aggiunge le colonne necessarie per supportare il piano dei conti
-- italiano completo a 3 livelli (livello 1 = macro voce CE B.6/B.7/...,
-- livello 2 = sotto-categoria, livello 3 = conto contabile dettagliato).

ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS level integer,
  ADD COLUMN IF NOT EXISTS ce_section text,
  ADD COLUMN IF NOT EXISTS is_revenue boolean DEFAULT false;

COMMENT ON COLUMN chart_of_accounts.level IS
  'Livello gerarchico nel piano dei conti italiano: 1=macro voce CE (es. 51, 61), 2=sotto-categoria (es. 5101, 6303), 3=conto specifico (es. 510107, 630301). Solo livello 3 è assegnabile a budget_entries.';

COMMENT ON COLUMN chart_of_accounts.ce_section IS
  'Sezione del Conto Economico civilistico italiano: A.1, A.5, B.6, B.7, B.8, B.9, B.10, B.11, B.14, C.16, C.17, E.20, E.21';

COMMENT ON COLUMN chart_of_accounts.is_revenue IS
  'TRUE per ricavi/proventi (codici 51, 59, 81, 89), FALSE per costi/oneri.';

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_level ON chart_of_accounts(company_id, level);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_ce_section ON chart_of_accounts(company_id, ce_section);
