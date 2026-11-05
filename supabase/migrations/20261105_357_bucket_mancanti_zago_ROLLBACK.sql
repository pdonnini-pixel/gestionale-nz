-- ROLLBACK della migrazione 357: SOLO SU ZAGO, e solo se i bucket sono ancora
-- vuoti. Su NZ questi bucket e queste policy esistevano gia' prima della 357 e
-- contengono file veri: NON eseguire questo file su NZ.
-- Il controllo qui sotto ferma tutto se in uno dei cinque bucket c'e' un file.
DO $$
DECLARE
  b text;
  s text;
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects
              WHERE bucket_id IN ('balance-sheets','bank-statements','contract-documents',
                                  'general-documents','invoices')) THEN
    RAISE EXCEPTION 'Rollback 357 fermato: nei bucket ci sono file. Non si cancella niente.';
  END IF;
  FOREACH b IN ARRAY ARRAY['balance-sheets', 'bank-statements', 'contract-documents',
                           'general-documents', 'invoices'] LOOP
    s := replace(b, '-', '_');
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', 'auth_read_' || s);
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', 'auth_write_' || s);
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', 'auth_del_' || s);
    DELETE FROM storage.buckets WHERE id = b;
  END LOOP;
END $$;
