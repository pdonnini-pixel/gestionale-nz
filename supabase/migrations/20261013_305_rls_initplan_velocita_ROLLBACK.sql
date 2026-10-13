-- ROLLBACK di 20261013_305_rls_initplan_velocita
--
-- Rimette ogni policy dello schema public esattamente com'era, leggendo la copia
-- salvata in public._bkp_rls_policies_20261013 prima della modifica.
-- Non tocca dati. La tabella di copia resta (si può eliminare a parte, a mano).
-- Da lanciare su NZ -> Made -> Zago.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = public, extensions;

DO $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT b.tablename, b.policyname, b.qual, b.with_check
    FROM public._bkp_rls_policies_20261013 b
    JOIN pg_policies p
      ON p.schemaname = 'public' AND p.tablename = b.tablename AND p.policyname = b.policyname
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename)
      || CASE WHEN r.qual IS NULL THEN '' ELSE format(' USING (%s)', r.qual) END
      || CASE WHEN r.with_check IS NULL THEN '' ELSE format(' WITH CHECK (%s)', r.with_check) END;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'policy ripristinate: %', n;
END $$;

-- Verifica: ogni policy deve coincidere con la copia.
DO $$
DECLARE n_diff int;
BEGIN
  SELECT count(*) INTO n_diff
  FROM public._bkp_rls_policies_20261013 b
  JOIN pg_policies p
    ON p.schemaname = 'public' AND p.tablename = b.tablename AND p.policyname = b.policyname
  WHERE p.qual IS DISTINCT FROM b.qual OR p.with_check IS DISTINCT FROM b.with_check;
  IF n_diff > 0 THEN
    RAISE EXCEPTION 'ripristino incompleto: % policy diverse dalla copia', n_diff;
  END IF;
END $$;

COMMIT;
