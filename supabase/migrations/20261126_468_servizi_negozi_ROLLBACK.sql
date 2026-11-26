-- ROLLBACK 468 · Servizi del negozio. ATTENZIONE: toglie le regole e il calendario delle consegne
-- scritti dagli utenti. Prima fare il backup:
--   SELECT * FROM public.outlet_servizi;  SELECT * FROM public.outlet_consegne;
BEGIN;
DROP FUNCTION IF EXISTS public.responsabile_consegna_togli(uuid, date);
DROP FUNCTION IF EXISTS public.responsabile_consegna_salva(uuid, date, time, time, int, boolean, text);
DROP FUNCTION IF EXISTS public.responsabile_servizi(date, date);
DROP FUNCTION IF EXISTS public.responsabile_mio_negozio(uuid);
DROP TABLE IF EXISTS public.outlet_consegne;
DROP TABLE IF EXISTS public.outlet_servizi;
COMMIT;
