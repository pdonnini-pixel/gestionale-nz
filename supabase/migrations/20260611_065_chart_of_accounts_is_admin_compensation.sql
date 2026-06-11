-- 065 — Compensi amministratori: flag sui conti di emolumento amministratori.
-- Colonna additiva applicata ai 3 tenant (NZ/Made/Zago) via MCP il 2026-06-11.
-- Flag dei conti solo su NZ (Made/Zago: i conti potrebbero non esistere → nessun dato).
-- Backup chart_of_accounts_bkp_20260611 prima dell'UPDATE. Solo ADD COLUMN + UPDATE additivo.

ALTER TABLE public.chart_of_accounts ADD COLUMN IF NOT EXISTS is_admin_compensation boolean NOT NULL DEFAULT false;

-- NZ-only (eseguito sul tenant NZ):
-- CREATE TABLE IF NOT EXISTS public.chart_of_accounts_bkp_20260611 AS SELECT * FROM public.chart_of_accounts;
-- UPDATE public.chart_of_accounts SET is_admin_compensation = true
--   WHERE code IN ('630343','630373','630772');  -- INPS gest.sep. collab., Emolumenti amministratori, Rimborsi pie di lista
