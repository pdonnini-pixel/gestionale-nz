-- Migrazione 110 — Bucket 'media': UPDATE/DELETE limitati a proprietario o super_advisor
-- (audit sezione Ticket 2026-07-19, finding #4: "Bucket media: INSERT/UPDATE/DELETE
--  aperti a ogni autenticato non-viewer su tutto il bucket").
--
-- Stato attuale (migration 054): INSERT/UPDATE/DELETE consentiti a qualunque utente
-- autenticato non-viewer su QUALSIASI file del bucket, senza legame con chi lo ha
-- caricato. Chiunque (es. un account contabile compromesso) può cancellare o
-- sovrascrivere gli allegati di tutti i ticket con una chiamata storage diretta.
--
-- Nuove regole:
-- - INSERT: invariato (autenticato non-viewer) — serve per caricare allegati
--   alla creazione del ticket.
-- - UPDATE/DELETE: solo il proprietario del file (chi lo ha caricato) oppure un
--   super_advisor. Copre i flussi reali dell'app: la rimozione allegati avviene
--   solo nei percorsi admin (cancellaTicket / bulkDelete), l'upsert di retry è
--   dello stesso utente che ha caricato.
-- - Manteniamo l'esclusione del ruolo 'viewer' introdotta dalla 054.
--
-- Nota: storage.objects ha sia owner (uuid, deprecato) sia owner_id (text);
-- usiamo COALESCE per coprire file vecchi e nuovi.
--
-- ⚠️ REGOLA #0 — PARITÀ TENANT: applicare su NZ + Made + Zago, identica.
-- CARATTERE: solo policy, nessun dato/file toccato.

BEGIN;

DROP POLICY IF EXISTS "auth_update_media" ON storage.objects;
CREATE POLICY "auth_update_media" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'media'
    AND public.get_my_role()::text <> 'viewer'
    AND (
      COALESCE(owner_id, owner::text) = auth.uid()::text
      OR public.get_my_role()::text = 'super_advisor'
    )
  )
  WITH CHECK (
    bucket_id = 'media'
    AND public.get_my_role()::text <> 'viewer'
  );

DROP POLICY IF EXISTS "auth_del_media" ON storage.objects;
CREATE POLICY "auth_del_media" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'media'
    AND public.get_my_role()::text <> 'viewer'
    AND (
      COALESCE(owner_id, owner::text) = auth.uid()::text
      OR public.get_my_role()::text = 'super_advisor'
    )
  );

COMMIT;

-- Verifica post-applicazione (deve restituire 2 righe con la condizione owner):
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--     AND policyname IN ('auth_update_media', 'auth_del_media');
--
-- Rollback (torna alle policy della 054):
--   DROP POLICY IF EXISTS "auth_update_media" ON storage.objects;
--   CREATE POLICY "auth_update_media" ON storage.objects FOR UPDATE
--     USING (bucket_id = 'media' AND auth.role() = 'authenticated' AND public.get_my_role()::text <> 'viewer');
--   DROP POLICY IF EXISTS "auth_del_media" ON storage.objects;
--   CREATE POLICY "auth_del_media" ON storage.objects FOR DELETE
--     USING (bucket_id = 'media' AND auth.role() = 'authenticated' AND public.get_my_role()::text <> 'viewer');
