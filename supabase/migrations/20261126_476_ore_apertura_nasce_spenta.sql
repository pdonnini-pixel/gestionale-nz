-- =====================================================================
-- 476 · «Chi apre resta N ore» nasce spenta, anche nei negozi nuovi
-- =====================================================================
-- Patrizio, 26/11/2026: «falla nascere spenta anche nei negozi nuovi». Dalla 474 NULL valeva
-- accesa; ora vale solo true. Il codice (oreDiChiApre) tratta NULL e false come spenta, e una
-- riga nuova nasce con false. Nessun dato cambia: dopo la 475 tutte le righe sono false.
-- Rollback: 20261126_476_ore_apertura_nasce_spenta_ROLLBACK.sql
-- =====================================================================
BEGIN;
ALTER TABLE public.outlet_shift_rules ALTER COLUMN caldi_ore_apertura_attiva SET DEFAULT false;
COMMENT ON COLUMN public.outlet_shift_rules.caldi_ore_apertura_attiva IS
  'Giorni caldi: chi fa l''apertura resta caldi_ore_apertura ore (Patrizio, 26/11/2026). Solo true = accesa; NULL o false = spenta, chi apre entra all''apertura e la durata la decide il motore. Nasce spenta (default false, migration 476).';
COMMIT;
-- Verifica: SELECT column_default FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='outlet_shift_rules' AND column_name='caldi_ore_apertura_attiva';  -- false
