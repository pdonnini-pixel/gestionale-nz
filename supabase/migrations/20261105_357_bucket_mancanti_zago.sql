-- =====================================================================
-- Migrazione 357 — Le cartelle dei file che mancavano su Zago
-- =====================================================================
-- COSA MANCAVA: su Zago non esistono i bucket balance-sheets,
-- bank-statements, contract-documents, general-documents e invoices, ne' le
-- loro policy (verifica del 05/11/2026; su NZ ci sono tutti). Le pagine che
-- li usano fallivano al primo caricamento: Documenti banca e Allegati del
-- movimento (bank-statements), Import e Conto economico (balance-sheets),
-- Outlet (contract-documents, general-documents), Archivio documenti
-- (invoices), Convertitore fatture XML e Ticket (general-documents).
--
-- COSA FA: crea solo cio' che manca, con le stesse impostazioni di NZ
-- (privati, nessun limite di dimensione o tipo) e le stesse policy di NZ
-- (lettura, caricamento e cancellazione per gli utenti autenticati).
-- Restano in vigore le RESTRITTIVE della 352 e della 353: l'account di
-- cassa e il dipendente non raggiungono questi bucket.
-- Su NZ non cambia niente: bucket e policy ci sono gia'. Nessun DROP,
-- nessun file toccato. Rilanciabile.
--
-- NOTA: su NZ il bucket contract-documents ha anche tre policy doppie
-- («Auth read/upload/delete contract-documents») con la stessa condizione
-- delle auth_*: qui si crea solo la serie auth_*, il risultato e' lo stesso.
--
-- PARITA' TENANT: dal 03/11/2026 NZ + Zago (niente Made).
-- =====================================================================

INSERT INTO storage.buckets (id, name, public)
SELECT b, b, false
  FROM unnest(ARRAY['balance-sheets', 'bank-statements', 'contract-documents',
                    'general-documents', 'invoices']) AS b
 WHERE NOT EXISTS (SELECT 1 FROM storage.buckets x WHERE x.id = b);

DO $$
DECLARE
  b text;
  s text;  -- suffisso del nome della policy: balance-sheets -> balance_sheets
BEGIN
  FOREACH b IN ARRAY ARRAY['balance-sheets', 'bank-statements', 'contract-documents',
                           'general-documents', 'invoices'] LOOP
    s := replace(b, '-', '_');
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                     AND policyname = 'auth_read_' || s) THEN
      EXECUTE format('CREATE POLICY %I ON storage.objects FOR SELECT TO authenticated USING (bucket_id = %L)',
                     'auth_read_' || s, b);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                     AND policyname = 'auth_write_' || s) THEN
      EXECUTE format('CREATE POLICY %I ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = %L)',
                     'auth_write_' || s, b);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                     AND policyname = 'auth_del_' || s) THEN
      EXECUTE format('CREATE POLICY %I ON storage.objects FOR DELETE TO authenticated USING (bucket_id = %L)',
                     'auth_del_' || s, b);
    END IF;
  END LOOP;
END $$;

-- Verifica (attesi 5 bucket privati e 15 policy auth_* su entrambi i tenant):
--   SELECT id, public FROM storage.buckets
--    WHERE id IN ('balance-sheets','bank-statements','contract-documents','general-documents','invoices');
--   SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
--    AND policyname ~ '^auth_(read|write|del)_(balance_sheets|bank_statements|contract_documents|general_documents|invoices)$';
