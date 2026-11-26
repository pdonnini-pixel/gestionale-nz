-- Rollback della 474. Toglie solo la colonna nuova: le righe con la regola spenta
-- tornano ad avere chi apre per caldi_ore_apertura ore (comportamento di prima).
-- Prima di eseguirlo: SELECT outlet_id, caldi_ore_apertura_attiva FROM public.outlet_shift_rules
--   WHERE caldi_ore_apertura_attiva IS NOT NULL;  (backup delle scelte salvate)
BEGIN;
ALTER TABLE public.outlet_shift_rules DROP COLUMN IF EXISTS caldi_ore_apertura_attiva;
COMMIT;
