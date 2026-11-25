-- Rollback della 466. La colonna e' nuova: toglierla perde solo i patroni indicati dopo la 466.
BEGIN;
ALTER TABLE public.outlets DROP CONSTRAINT IF EXISTS outlets_festa_patrono_formato;
ALTER TABLE public.outlets DROP COLUMN IF EXISTS festa_patrono;
COMMIT;
