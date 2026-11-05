-- =====================================================================
-- Migrazione 353 — L'account del dipendente non raggiunge nessun file
-- =====================================================================
-- COSA MANCAVA: le policy di storage.objects dei bucket privati
-- (balance-sheets, bank-statements, contract-documents, employee-documents,
-- general-documents, invoices, outlet-attachments, riba-distinte, media,
-- cash-closings per la parte lettura del proprio negozio) controllano solo
-- bucket_id. La 249 ha recintato il ruolo 'dipendente' sulle tabelle, ma non
-- sui file: un dipendente con l'app avrebbe potuto leggere contratti e buste
-- paga dei colleghi, fatture ed estratti conto. Al 05/11/2026 non esiste
-- ancora nessun account 'dipendente' (0 su NZ e 0 su Zago): il recinto si
-- costruisce prima che arrivino, come chiede la 249. Segnalato dalla
-- revisione della migrazione 352.
--
-- COSA FA: una policy RESTRITTIVA su storage.objects che per il ruolo
-- 'dipendente' e' sempre falsa (nessun bucket) e per tutti gli altri ruoli
-- sempre vera (nulla cambia). Solo CREATE POLICY: nessun DROP, nessun file
-- toccato. Rilanciabile.
--
-- PERCHE' NESSUN BUCKET (verifica del 05/11/2026): il dipendente apre solo
-- /app (src/pages/AppDipendente.tsx e src/components/app/*, anche nelle PR
-- aperte #745 e #748), che usa solo RPC e la Edge Function
-- app-dipendente-attiva, mai Storage. Se un giorno l'app dovesse mostrare
-- un file (per esempio la propria busta paga), lo si servira' con un URL
-- firmato da una Edge Function, non aprendo un bucket a tutti i dipendenti.
--
-- PARITA' TENANT: dal 03/11/2026 NZ + Zago (niente Made).
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'dipendente_block') THEN
    CREATE POLICY dipendente_block ON storage.objects
      AS RESTRICTIVE FOR ALL TO authenticated
      USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
      WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');
  END IF;
END $$;

-- Verifica (attesa 1 riga RESTRICTIVE):
--   SELECT policyname, permissive, cmd FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND policyname = 'dipendente_block';
