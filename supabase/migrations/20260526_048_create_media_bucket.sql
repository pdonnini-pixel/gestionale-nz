-- Migration 048: crea bucket Storage 'media' per allegati ticket
--
-- Bug scoperto al primo test reale di Patrizio: upload allegati su ticket
-- falliva sempre con messaggio 'allegato non caricato'. Causa: il codice
-- (Ticket.tsx, CreateTicketModal) fa supabase.storage.from('media').upload
-- ma il bucket 'media' NON ESISTEVA in nessuno dei 3 tenant.
-- Mai stato creato (il sistema ticket originale era stato mergeato senza
-- la migration storage).
--
-- Configurazione:
-- - public: true -> URL pubblici di lettura (gli screenshot devono essere
--   visualizzabili nei ticket via <img src=publicUrl />)
-- - file_size_limit: 10 MB (coerente con MAX_ATTACHMENT_BYTES nel client)
-- - allowed_mime_types: PNG, JPG, WEBP, GIF, PDF (coerente con
--   ALLOWED_ATTACHMENT_TYPES nel client)
-- - Policies: read = anyone (bucket public), write/delete/update = solo
--   utenti autenticati

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media', 'media', true,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "auth_read_media" ON storage.objects FOR SELECT
  USING (bucket_id = 'media');

CREATE POLICY "auth_write_media" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'media' AND auth.role() = 'authenticated');

CREATE POLICY "auth_del_media" ON storage.objects FOR DELETE
  USING (bucket_id = 'media' AND auth.role() = 'authenticated');

CREATE POLICY "auth_update_media" ON storage.objects FOR UPDATE
  USING (bucket_id = 'media' AND auth.role() = 'authenticated');
