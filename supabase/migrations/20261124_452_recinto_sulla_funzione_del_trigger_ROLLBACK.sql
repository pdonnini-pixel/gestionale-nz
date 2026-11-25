-- ROLLBACK di 20261124_452_recinto_sulla_funzione_del_trigger.sql
--
-- Rimette l'EXECUTE a PUBLIC sulla funzione del trigger, cioe' il default di
-- PostgreSQL. Non serve a niente e non lo si fa: resta qui per simmetria.

BEGIN;

GRANT EXECUTE ON FUNCTION public.trg_cassa_ricalcola_successive() TO PUBLIC;

COMMIT;
