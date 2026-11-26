-- ROLLBACK 471. ATTENZIONE: perde le persone dedicate e il tetto scritti dagli utenti; prima:
--   SELECT id, outlet_id, tipo, giorno, dedicate FROM public.outlet_servizi WHERE cardinality(dedicate) > 0;
--   SELECT outlet_id, tetto_persone_giorno, tetto_giorni FROM public.outlet_shift_rules WHERE tetto_persone_giorno IS NOT NULL;
BEGIN;
ALTER TABLE public.outlet_servizi DROP COLUMN IF EXISTS dedicate;
ALTER TABLE public.outlet_shift_rules DROP COLUMN IF EXISTS tetto_persone_giorno;
ALTER TABLE public.outlet_shift_rules DROP COLUMN IF EXISTS tetto_giorni;
COMMIT;
