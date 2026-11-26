-- Rollback della 476: toglie il default (il significato di NULL lo decide il codice).
BEGIN;
ALTER TABLE public.outlet_shift_rules ALTER COLUMN caldi_ore_apertura_attiva DROP DEFAULT;
COMMIT;
