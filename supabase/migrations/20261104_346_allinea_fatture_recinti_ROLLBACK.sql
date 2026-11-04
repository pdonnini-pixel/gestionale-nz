-- ROLLBACK di 20261104_346_allinea_fatture_recinti.sql
--
-- Toglie il trigger sulla chiusura confermata e la sua funzione.
--
-- Il REVOKE alle funzioni NON si annulla: rimetterlo vorrebbe dire rendere di
-- nuovo chiamabile senza login una funzione che scrive su payables. Se davvero
-- servisse, va fatto a mano e con una ragione scritta.
--
-- Le due funzioni di allineamento restano nella versione con i recinti. Per
-- tornare alla versione larga della 345 si riapplica quel file, ma prima si
-- legga perche' i recinti ci sono (testa della 346). E attenzione: la 345
-- contiene un GRANT EXECUTE ... TO authenticated, quindi riapplicarla riapre
-- le funzioni a chi ha un login. Dopo averla riapplicata va rifatto il REVOKE:
--   REVOKE ALL ON FUNCTION public.allinea_fattura_da_cassa(uuid)
--     FROM PUBLIC, anon, authenticated;
--   REVOKE ALL ON FUNCTION public.allinea_fatture_pagate_in_contanti(integer)
--     FROM PUBLIC, anon, authenticated;

BEGIN;

DROP TRIGGER IF EXISTS allinea_chiusura_confermata ON public.outlet_daily_closings;
DROP FUNCTION IF EXISTS public.trg_allinea_chiusura_confermata();

COMMIT;
