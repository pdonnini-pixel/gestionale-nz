-- Rollback della 478: torna il turno massimo di 10 ore (tutti i negozi erano a 10 prima della 478).
BEGIN;
UPDATE public.outlet_shift_rules SET turno_max_ore = 10, updated_at = now() WHERE turno_max_ore = 8;
ALTER TABLE public.outlet_shift_rules ALTER COLUMN turno_max_ore SET DEFAULT 10;
COMMIT;
