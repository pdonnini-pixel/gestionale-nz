-- ROLLBACK di 20261104_344_annulla_correzione_istruttoria.sql

BEGIN;

DROP FUNCTION IF EXISTS public.undo_closing_check(uuid);

COMMIT;
