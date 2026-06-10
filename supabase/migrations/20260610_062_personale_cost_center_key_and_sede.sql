-- 062 — Popolamento cost_center_key + outlet SEDE / MAGAZZINO.
-- Applicata via MCP Supabase il 2026-06-10. Backup outlets_bkp_20260610 creato su ogni tenant.
-- NO DATA LOSS: UPDATE su colonna appena aggiunta (tutta NULL) + INSERT additivo.

-- Snapshot di sicurezza prima di toccare i dati.
CREATE TABLE IF NOT EXISTS public.outlets_bkp_20260610 AS SELECT * FROM public.outlets;

-- Tutti i tenant: cost_center_key = lower(name) (formula, niente hardcoded).
UPDATE public.outlets SET cost_center_key = lower(name) WHERE cost_center_key IS NULL;

-- Solo tenant con un cost_center 'sede_magazzino' (NZ): crea l'outlet SEDE / MAGAZZINO.
-- Su Made/Zago il blocco è no-op (manca il cost_center sede) -> niente hardcoded NZ.
INSERT INTO public.outlets (company_id, name, code, cost_center_key, is_active)
SELECT (SELECT company_id FROM public.outlets WHERE code IS DISTINCT FROM 'SED' ORDER BY created_at NULLS LAST LIMIT 1),
       'SEDE / MAGAZZINO', 'SED', 'sede_magazzino', true
WHERE EXISTS (SELECT 1 FROM public.cost_centers WHERE code = 'sede_magazzino')
  AND NOT EXISTS (SELECT 1 FROM public.outlets WHERE code = 'SED' OR cost_center_key = 'sede_magazzino');
