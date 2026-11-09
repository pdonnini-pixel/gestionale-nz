-- ROLLBACK della 376
BEGIN;
DROP FUNCTION IF EXISTS public.ferie_richieste_prova();
COMMIT;
