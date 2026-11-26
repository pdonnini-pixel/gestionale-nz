-- Rollback della 475: torna allo stato del 26/11/2026 prima della modifica (tutte NULL = accesa).
BEGIN;
UPDATE public.outlet_shift_rules SET caldi_ore_apertura_attiva = NULL, updated_at = now()
 WHERE caldi_ore_apertura_attiva = false;
COMMIT;
