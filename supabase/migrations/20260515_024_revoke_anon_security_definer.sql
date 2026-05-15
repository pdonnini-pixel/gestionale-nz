-- Migrazione 024 — Revoke anon EXECUTE su tutte le RPC SECURITY DEFINER del nostro schema
-- Le RPC del frontend richiedono login (authenticated), nessuna è pensata per anon.
-- Patch: anche credentials RPC con REVOKE FROM PUBLIC perché anon eredita da PUBLIC.

DO $$
DECLARE
  f RECORD;
  cnt INTEGER := 0;
BEGIN
  FOR f IN
    SELECT p.proname AS func_name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND d.objid IS NULL
      AND p.prosecdef = true
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon', f.func_name, f.args);
      cnt := cnt + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skip %(%): %', f.func_name, f.args, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'Revocato PUBLIC+anon su % funzioni SECURITY DEFINER', cnt;
END $$;
