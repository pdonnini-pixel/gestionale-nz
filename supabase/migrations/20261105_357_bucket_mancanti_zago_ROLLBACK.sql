-- ROLLBACK della migrazione 357: SOLO SU ZAGO. Su NZ questi bucket e queste
-- policy esistevano gia' prima della 357: NON eseguire questo file su NZ.
-- Toglie solo le 15 policy auth_* dei cinque bucket e lascia i bucket, che
-- vuoti sono innocui: niente DELETE su storage.buckets, cosi' nessun bucket e
-- nessun file puo' sparire nemmeno per errore. Senza policy i bucket restano
-- inaccessibili agli utenti (solo service role).
DO $$
DECLARE
  b text;
  s text;
BEGIN
  FOREACH b IN ARRAY ARRAY['balance-sheets', 'bank-statements', 'contract-documents',
                           'general-documents', 'invoices'] LOOP
    s := replace(b, '-', '_');
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', 'auth_read_' || s);
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', 'auth_write_' || s);
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', 'auth_del_' || s);
  END LOOP;
END $$;
