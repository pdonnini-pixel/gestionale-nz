-- 20260707_086_rls_enable_payables_dedup_backups.sql
--
-- Chiude gli advisor di sicurezza Supabase:
--   - rls_disabled_in_public   (ERROR)
--   - sensitive_columns_exposed (ERROR, colonna `iban`)
-- sulle 3 tabelle di backup/lavoro residue del dedup payables del 17/06/2026,
-- ancora esposte nello schema `public` via PostgREST senza RLS:
--   - payables_bkp_dedup_20260617
--   - payables_dedup_review_20260617   (il pattern auto-RLS `%_bkp_%` della 067 NON la copriva)
--   - payables_bkp_mp08_20260617
--
-- NON DISTRUTTIVO: solo ENABLE ROW LEVEL SECURITY, nessuna policy, nessun DROP.
-- RLS senza policy => accesso NEGATO ad anon/authenticated: le tabelle non sono
-- piu' leggibili via API (iban incluso). service_role bypassa RLS, quindi i
-- backup restano accessibili per un eventuale restore.
--
-- Idempotente e parity-safe: to_regclass salta le tabelle inesistenti su un tenant
-- (potrebbero esistere solo su NZ). Riapplicabile senza effetti collaterali:
-- ENABLE RLS su tabella gia' protetta e' un no-op.
--
-- PARITA' TENANT (Regola #0): applicare su NZ + Made + Zago.
--
-- Nota: NON tocca i dati. La rimozione definitiva di questi backup (distruttiva)
-- e' gia' disponibile in repo, se e quando la si vorra' fare, in
-- 20260703_055_drop_golive_backup_tables.sql.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'payables_bkp_dedup_20260617',
    'payables_dedup_review_20260617',
    'payables_bkp_mp08_20260617'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      RAISE NOTICE 'RLS enabled on public.%', t;
    ELSE
      RAISE NOTICE 'skip: public.% non esiste su questo tenant', t;
    END IF;
  END LOOP;
END $$;

-- Verifica post-applicazione (atteso relrowsecurity = true per le tabelle presenti):
-- SELECT relname, relrowsecurity
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND relname IN (
--     'payables_bkp_dedup_20260617',
--     'payables_dedup_review_20260617',
--     'payables_bkp_mp08_20260617'
--   );
