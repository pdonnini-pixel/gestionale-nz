-- 20261124_452_recinto_sulla_funzione_del_trigger.sql
--
-- Il recinto sulla funzione del trigger del ricalcolo (migration 451).
--
-- Rilievo dei tre revisori: `trg_cassa_ricalcola_successive()` e' SECURITY
-- DEFINER e la 451 non le ha tolto l'EXECUTE a PUBLIC, che PostgreSQL concede
-- per default. Non e' sfruttabile (una funzione che restituisce `trigger` non
-- si chiama ne' via PostgREST ne' da SQL: «trigger functions can only be
-- called as triggers»), ma la casa fa diversamente: la migration 289 toglie
-- l'EXECUTE anche a `fn_cash_closing_reproject()`, che e' la stessa cosa.
-- Misurato su NZ prima di questa migration: `authenticated` aveva EXECUTE sulla
-- funzione nuova e non su quella del 2026-10, e l'advisor
-- `anon_security_definer_function_executable` l'avrebbe segnalata.
--
-- Il REVOKE non ferma il trigger: PostgreSQL non controlla l'EXECUTE quando
-- un trigger scatta, lo esegue come proprietario della tabella.

BEGIN;

REVOKE ALL ON FUNCTION public.trg_cassa_ricalcola_successive() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_cassa_ricalcola_successive() FROM anon;
REVOKE ALL ON FUNCTION public.trg_cassa_ricalcola_successive() FROM authenticated;

COMMIT;

-- Verifica, su NZ e su Zago (tutti e tre false):
--
-- SELECT has_function_privilege('authenticated','public.trg_cassa_ricalcola_successive()','execute') AS auth,
--        has_function_privilege('anon','public.trg_cassa_ricalcola_successive()','execute')          AS anon,
--        has_function_privilege('public','public.trg_cassa_ricalcola_successive()','execute')        AS pubblico;
--
-- E che il trigger funzioni ancora (in una transazione annullata):
--
-- BEGIN;
--   UPDATE public.outlet_daily_closings SET cash_pending_declared = cash_pending_declared + 100
--    WHERE id = '<una chiusura confermata>';   -- il giorno dopo deve spostarsi
-- ROLLBACK;
