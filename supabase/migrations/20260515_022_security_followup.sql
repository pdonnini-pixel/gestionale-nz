-- Migrazione 022 — Security follow-up
-- 1. Sposta _migrations_log in private (se esiste in public)
-- 2. Revoke EXECUTE su credentials RPC da anon/authenticated
-- 3. Hardening search_path su tutte le funzioni custom

-- Step 1
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='_migrations_log') THEN
    CREATE SCHEMA IF NOT EXISTS private;
    REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
    EXECUTE 'ALTER TABLE public._migrations_log SET SCHEMA private';
    RAISE NOTICE 'Spostata public._migrations_log -> private';
  END IF;
END $$;

-- Step 2: revoke credentials RPC
DO $$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY['get_sdi_credentials', 'get_yapily_credentials']
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = fn
    ) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I() FROM anon, authenticated', fn);
      RAISE NOTICE 'Revocato EXECUTE su %', fn;
    END IF;
  END LOOP;
END $$;

-- Step 3: hardening search_path su funzioni custom (esclude funzioni di estensioni)
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
      AND (p.proconfig IS NULL OR NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'
      ))
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp', f.func_name, f.args);
      cnt := cnt + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skip %(%): %', f.func_name, f.args, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'Hardened % funzioni con search_path esplicito', cnt;
END $$;
