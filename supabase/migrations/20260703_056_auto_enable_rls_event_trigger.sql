-- 20260703_056_auto_enable_rls_event_trigger.sql
--
-- GUARDRAIL anti-ricaduta per il linter "rls_disabled_in_public" /
-- "sensitive_columns_exposed": un event trigger attiva automaticamente la RLS
-- su OGNI nuova tabella creata nello schema `public`. Così un backup/tabella
-- temporanea nasce già "chiusa" (RLS on, nessuna policy = nessun accesso via
-- API anon/authenticated; il service role bypassa sempre la RLS).
--
-- Convenzione complementare: i backup andrebbero comunque creati nello schema
-- `backups` (non esposto a PostgREST), non in `public`.
--
-- PARITÀ TENANT (Regola #0): eseguire su NZ + Made + Zago.

CREATE OR REPLACE FUNCTION public.auto_enable_rls_on_new_tables()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT object_identity
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag = 'CREATE TABLE'
      AND object_type = 'table'
      AND schema_name = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.object_identity);
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS trg_auto_rls_public;
CREATE EVENT TRIGGER trg_auto_rls_public
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE')
  EXECUTE FUNCTION public.auto_enable_rls_on_new_tables();

COMMENT ON FUNCTION public.auto_enable_rls_on_new_tables() IS
  'Event trigger: attiva RLS su ogni nuova tabella in public (anti-esposizione API). Migr. 056.';
