-- ROLLBACK di 20261104_345_fattura_in_contanti_allinea_scadenzario.sql
--
-- Toglie il cron, il trigger e le due funzioni.
--
-- Le correzioni gia' fatte sulle fatture NON vengono annullate (regola NO DATA
-- LOSS): metodo, data e nota restano come li ha scritti l'allineamento, e in
-- payable_actions resta la riga che dice cosa c'era prima. Per rimettere una
-- fattura com'era si parte da quella traccia:
--   SELECT payable_id, note, performed_at FROM public.payable_actions
--    WHERE action_type IN ('chiusa_in_contanti', 'metodo_corretto', 'data_corretta', 'correzione_metodo')
--    ORDER BY performed_at DESC;

-- Prima di questo va fatto il ROLLBACK della 346: il suo trigger
-- allinea_chiusura_confermata chiama allinea_fattura_da_cassa, e se la
-- funzione non c'e' piu' ogni conferma di chiusura lascia un warning.

SELECT cron.unschedule('allinea-fatture-contanti');

BEGIN;

DROP TRIGGER IF EXISTS allinea_fattura_da_cassa ON public.outlet_daily_closing_expenses;
DROP FUNCTION IF EXISTS public.trg_allinea_fattura_da_cassa();
DROP FUNCTION IF EXISTS public.allinea_fatture_pagate_in_contanti(integer);
DROP FUNCTION IF EXISTS public.allinea_fattura_da_cassa(uuid);

COMMIT;
