-- 067: enable RLS on exposed backup tables (non-destructive: solo ENABLE, nessuna policy, nessun drop)
-- Chiude l'advisor security `rls_disabled_in_public` (ERROR) sulle tabelle di backup
-- nello schema public ancora leggibili via PostgREST da anon/authenticated.
-- Abilitare RLS senza aggiungere policy => accesso negato a anon/authenticated.
-- service_role bypassa RLS, quindi i backup restano accessibili per eventuale restore.
-- Idempotente e parity-safe sui 3 tenant: il loop seleziona solo le tabelle ancora scoperte,
-- quindi tabelle solo-NZ inesistenti su Made/Zago vengono semplicemente saltate.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
      AND (c.relname LIKE '%\_bkp\_%' ESCAPE '\'
           OR c.relname LIKE 'backup\_%' ESCAPE '\'
           OR c.relname LIKE '\_backup\_%' ESCAPE '\')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.relname);
    RAISE NOTICE 'RLS enabled on %', r.relname;
  END LOOP;
END $$;
