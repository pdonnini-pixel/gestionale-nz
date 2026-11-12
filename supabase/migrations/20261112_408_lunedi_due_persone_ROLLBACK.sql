-- ROLLBACK della 408: toglie la scelta «lunedi' a due persone».
-- ATTENZIONE (NO DATA LOSS): DROP COLUMN cancella la scelta fatta dai negozi che l'hanno
-- accesa. Prima salvare i valori e chiedere conferma a Patrizio:
--   SELECT outlet_id, lunedi_due_persone FROM public.outlet_shift_rules WHERE lunedi_due_persone IS NOT NULL;
BEGIN;
ALTER TABLE public.outlet_shift_rules DROP COLUMN IF EXISTS lunedi_due_persone;
COMMIT;
