-- =====================================================================
-- Migrazione 351 — L'account di cassa vede solo la cartella delle chiusure
-- =====================================================================
-- COSA MANCAVA: le policy di storage.objects dei bucket privati
-- (balance-sheets, bank-statements, contract-documents, employee-documents,
-- general-documents, invoices, outlet-attachments, riba-distinte, media)
-- controllano solo bucket_id. L'account di negozio (ruolo operatore_cassa)
-- poteva elencare, scaricare, caricare e cancellare file in tutte: il
-- 05/11/2026, su NZ, simulando un account di cassa vero, vedeva 49 documenti
-- dei dipendenti, 983 fatture, 84 estratti conto e 22 bilanci. Emerso dalla
-- revisione di sicurezza della migrazione 350.
--
-- COSA FA: una sola policy RESTRITTIVA su storage.objects. Per tutti i ruoli
-- diversi da operatore_cassa e' sempre vera (non cambia nulla); per
-- l'operatore di cassa lascia passare solo il bucket 'cash-closings', dove
-- restano valide le policy di quel bucket (solo il proprio negozio).
-- Solo CREATE POLICY: nessun DROP, nessun file toccato. Rilanciabile.
--
-- PERCHE' SOLO 'cash-closings' (verifica del 05/11/2026): ChiusuraCassa.tsx
-- usa solo BUCKET = 'cash-closings' (foto, firme, cancellazioni); Profilo.tsx
-- e Layout non usano Storage; 'media' lo usano solo Ticket e TicketAdmin,
-- pagine che il ruolo non puo' aprire (CASH_OPERATOR_PATHS in App.tsx);
-- closing-photo-extract scarica la foto con la service role (BYPASSRLS).
--
-- PARITA' TENANT: dal 03/11/2026 NZ + Zago (niente Made).
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'cash_operator_block') THEN
    CREATE POLICY cash_operator_block ON storage.objects
      AS RESTRICTIVE FOR ALL TO authenticated
      USING (bucket_id = 'cash-closings'
             OR COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
      WITH CHECK (bucket_id = 'cash-closings'
             OR COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
  END IF;
END $$;

-- Verifica (attesa 1 riga RESTRICTIVE):
--   SELECT policyname, permissive, cmd FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND policyname = 'cash_operator_block';
