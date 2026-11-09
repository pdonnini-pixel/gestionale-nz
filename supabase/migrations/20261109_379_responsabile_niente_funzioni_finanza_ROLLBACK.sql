-- ROLLBACK della 379: toglie la riga aggiunta in testa alle funzioni.
BEGIN;
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN SELECT oid FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prokind = 'f' AND pg_get_functiondef(oid) ~ 'migration 379' LOOP
    EXECUTE replace(pg_get_functiondef(p.oid), E'  PERFORM public.responsabile_non_qui(); -- migration 379\n', '');
  END LOOP;
END;
$$;
DROP FUNCTION IF EXISTS public.responsabile_non_qui();
COMMIT;
