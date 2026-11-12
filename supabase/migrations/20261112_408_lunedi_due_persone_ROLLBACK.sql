-- ROLLBACK della 408: toglie la scelta «lunedi' a due persone», lo straordinario
-- scritto a mano e il giorno di pubblicazione dei turni.
-- ATTENZIONE (NO DATA LOSS): i DROP COLUMN cancellano
--  * la scelta fatta dai negozi che l'hanno accesa;
--  * quali straordinari sono stati scritti a mano (dopo, il ricalcolo non li
--    distingue piu': ma senza la colonna il frontend non ricalcola affatto);
--  * il giorno di pubblicazione dei turni (si torna a leggere updated_at).
-- Prima salvare i valori e chiedere conferma a Patrizio:
--   SELECT outlet_id, lunedi_due_persone FROM public.outlet_shift_rules WHERE lunedi_due_persone IS NOT NULL;
--   SELECT id, straordinario_a_mano, pubblicato_il FROM public.shifts
--    WHERE straordinario_a_mano IS NOT NULL OR pubblicato_il IS NOT NULL;
BEGIN;
-- Copie prima dei DROP (nessun GRANT: invisibili all'API). Se esistono gia', ci si ferma.
DO $$ BEGIN
  IF to_regclass('public._bkp_408_shifts') IS NOT NULL
     OR to_regclass('public._bkp_408_outlet_shift_rules') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 408: esistono gia'' le copie _bkp_408_*. Controllarle prima di ripetere.';
  END IF;
END $$;
CREATE TABLE public._bkp_408_shifts AS
  SELECT id, straordinario_a_mano, pubblicato_il FROM public.shifts
   WHERE straordinario_a_mano IS NOT NULL OR pubblicato_il IS NOT NULL;
CREATE TABLE public._bkp_408_outlet_shift_rules AS
  SELECT outlet_id, lunedi_due_persone FROM public.outlet_shift_rules
   WHERE lunedi_due_persone IS NOT NULL;
ALTER TABLE public._bkp_408_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_408_outlet_shift_rules ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_shifts_pubblicato_il ON public.shifts;
DROP FUNCTION IF EXISTS public.shifts_pubblicato_il();
ALTER TABLE public.shifts
  DROP COLUMN IF EXISTS straordinario_a_mano,
  DROP COLUMN IF EXISTS pubblicato_il;
ALTER TABLE public.outlet_shift_rules DROP COLUMN IF EXISTS lunedi_due_persone;
COMMIT;
