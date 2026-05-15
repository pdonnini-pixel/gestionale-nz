-- Migrazione 020 — security cleanup NZ
-- Sposta tutte le tabelle *_backup_* + _yapily_diagnostic dallo schema public allo schema private
-- Risultato: -24 errori RLS_disabled + -2 errori sensitive_columns nel linter Supabase
-- Schema "private" non è esposto a PostgREST: dati preservati ma non più accessibili via API
-- Solo NZ aveva backup tables — questa migrazione è IDEMPOTENTE e safe su Made/Zago

CREATE SCHEMA IF NOT EXISTS private;

-- Restringi accesso al solo proprietario
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND (tablename LIKE '%_backup_%' OR tablename = '_yapily_diagnostic')
    ORDER BY tablename
  LOOP
    EXECUTE format('ALTER TABLE public.%I SET SCHEMA private', t.tablename);
    RAISE NOTICE 'Spostata: public.% -> private.%', t.tablename, t.tablename;
  END LOOP;
END $$;

DO $$
DECLARE
  cnt INTEGER;
BEGIN
  SELECT COUNT(*) INTO cnt
  FROM pg_tables
  WHERE schemaname = 'public'
    AND (tablename LIKE '%_backup_%' OR tablename = '_yapily_diagnostic');

  IF cnt > 0 THEN
    RAISE EXCEPTION 'Spostamento incompleto: % tabelle backup ancora in public', cnt;
  END IF;
END $$;
