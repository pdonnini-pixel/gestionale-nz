-- ROLLBACK migrazione 177 — cancellazione giornata di cassa
BEGIN;
DROP FUNCTION IF EXISTS public.delete_cash_closing(uuid, text);
COMMIT;
