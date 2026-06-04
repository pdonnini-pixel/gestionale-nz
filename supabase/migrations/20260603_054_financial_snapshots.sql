-- ─────────────────────────────────────────────────────────────────────────
-- 054 — financial_snapshots (NO DATA LOSS, ticket 9bf52ecc)
-- ─────────────────────────────────────────────────────────────────────────
-- Tabella di sicurezza: prima di ogni delete in blocco fatto dall'import
-- (vedi src/lib/parsers/importEngine.ts > processBalanceSheetPDF), salviamo qui
-- una copia integrale (jsonb) delle righe che stiamo per cancellare, così un
-- import sbagliato è sempre recuperabile.
--
-- MIGRAZIONE ADDITIVA (solo CREATE) — nessun rischio per i dati esistenti.
-- Da applicare a TUTTI E 3 i tenant: NZ + Made + Zago (REGOLA #0 parità tenant).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.financial_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid,
  source_table text,
  year        int,
  payload     jsonb,
  rows_count  int,
  created_by  text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_snapshots_lookup
  ON public.financial_snapshots (company_id, source_table, year, created_at DESC);

-- RLS coerente con balance_sheet_data: isolamento per company_id, scrittura
-- riservata a super_advisor e contabile (gli stessi che possono fare l'import).
ALTER TABLE public.financial_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financial_snapshots_select ON public.financial_snapshots;
CREATE POLICY financial_snapshots_select ON public.financial_snapshots
  FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS financial_snapshots_write ON public.financial_snapshots;
CREATE POLICY financial_snapshots_write ON public.financial_snapshots
  FOR ALL
  USING (
    company_id = get_my_company_id()
    AND get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role])
  );
