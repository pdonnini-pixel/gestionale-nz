-- ROLLBACK migrazione 114 — SOLO EMERGENZA.
-- ⚠️ Ri-espone via API le tabelle di backup (RLS off + grant ripristinati):
--    REINTRODUCE gli advisor 0013_rls_disabled_in_public e
--    0023_sensitive_columns_exposed (colonna `iban`). Da usare solo se un
--    processo legittimo avesse davvero bisogno di leggere questi snapshot via API
--    (caso non previsto: sono backup, non dati operativi).
-- ⚠️ REGOLA #0 — se applicato, applicarlo su NZ + Made + Zago.

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
      AND (
           c.relname LIKE '\_bkp\_%'   ESCAPE '\'
        OR c.relname LIKE '\_backup\_%' ESCAPE '\'
        OR c.relname LIKE 'backup\_2%'  ESCAPE '\'
        OR c.relname LIKE '%\_dup\_backup\_%' ESCAPE '\'
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated', t.tablename);
  END LOOP;
END $$;
