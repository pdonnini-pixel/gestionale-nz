-- =====================================================================
-- Migrazione 359 — Il viewer sui file: legge, non carica e non cancella
-- =====================================================================
-- COSA MANCAVA: la 240 ha reso il ruolo 'viewer' (Sola lettura) davvero in
-- sola lettura sulle tabelle, con policy RESTRITTIVE su INSERT / UPDATE /
-- DELETE. Sui file no: le policy di storage.objects di balance-sheets,
-- bank-statements, contract-documents, employee-documents,
-- general-documents, invoices, outlet-attachments e riba-distinte
-- controllano solo bucket_id, quindi un viewer poteva caricare, sostituire
-- e cancellare estratti conto, fatture, contratti e documenti dei
-- dipendenti chiamando l'API con il proprio token. (media escludeva gia' il
-- viewer; cash-closings lascia scrivere solo chi puo' compilare la
-- chiusura.) Segnalato dalla revisione della migrazione 357.
-- Verifica del 05/11/2026: 2 viewer su NZ e 2 su Zago; nessun file su NZ
-- e' stato caricato da un viewer.
--
-- COSA FA: tre policy RESTRITTIVE su storage.objects, per INSERT, UPDATE e
-- DELETE, che escludono il viewer su tutti i bucket. La lettura (SELECT)
-- non cambia: il viewer continua a vedere e scaricare i file che vede
-- oggi. Per tutti gli altri ruoli non cambia nulla. Solo CREATE POLICY,
-- nessun DROP, nessun file toccato. Rilanciabile.
--
-- PARITA' TENANT: dal 03/11/2026 NZ + Zago (niente Made).
-- =====================================================================

DO $$
DECLARE
  non_viewer constant text := 'COALESCE((SELECT public.get_my_role())::text, '''') <> ''viewer''';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'viewer_sola_lettura_insert') THEN
    EXECUTE format('CREATE POLICY viewer_sola_lettura_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)', non_viewer);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'viewer_sola_lettura_update') THEN
    EXECUTE format('CREATE POLICY viewer_sola_lettura_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', non_viewer, non_viewer);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'viewer_sola_lettura_delete') THEN
    EXECUTE format('CREATE POLICY viewer_sola_lettura_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING (%s)', non_viewer);
  END IF;
END $$;

-- Verifica (attese 3 righe RESTRICTIVE):
--   SELECT policyname, permissive, cmd FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND policyname LIKE 'viewer_sola_lettura_%';
