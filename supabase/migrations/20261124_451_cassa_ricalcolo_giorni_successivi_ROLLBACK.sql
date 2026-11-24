-- ROLLBACK di 20261124_451_cassa_ricalcolo_giorni_successivi.sql
--
-- Toglie il trigger e le due funzioni. Nessun dato viene perso: il ricalcolo
-- non ha mai scritto un numero contato a mano, ha solo rimesso a posto i campi
-- calcolati. Dopo il rollback torna il difetto di prima: riaprendo una
-- chiusura vecchia, i giorni dopo restano fermi al numero vecchio.

BEGIN;

DROP TRIGGER IF EXISTS trg_cassa_ricalcola_successive ON public.outlet_daily_closings;
DROP FUNCTION IF EXISTS public.trg_cassa_ricalcola_successive();
DROP FUNCTION IF EXISTS public.ricalcola_cassa_successive(uuid, date);

COMMIT;
