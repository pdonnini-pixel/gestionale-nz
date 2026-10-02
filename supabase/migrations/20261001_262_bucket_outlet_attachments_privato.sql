-- =====================================================================
-- 262 — Bucket «outlet-attachments» privato e presente su tutti e 3 i tenant
-- =====================================================================
-- La scheda outlet (Allegati) e il wizard caricano contratti, planimetrie,
-- preventivi e garanzie nel bucket «outlet-attachments».
-- Al 01/10/2026:
--   - su NZ il bucket era PUBBLICO: chiunque avesse il link di un file poteva
--     aprirlo senza login (contratti con clausola di riservatezza);
--   - su Made e Zago il bucket NON esisteva: ogni caricamento falliva.
-- Il codice legge questi file solo con download() e createSignedUrl()
-- (src/pages/Outlet.tsx, ArchivioDocumenti), mai con getPublicUrl, e nessun
-- link pubblico e' salvato in outlet_attachments.file_path: renderlo privato
-- non cambia niente per chi lavora loggato. Le tre regole (lettura, scrittura,
-- cancellazione per utenti autenticati) sono le stesse gia' attive su NZ;
-- il tenant e' fisico, un progetto per azienda.
-- Idempotente. Nessun file toccato.
-- =====================================================================
BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('outlet-attachments', 'outlet-attachments', false)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets SET public = false WHERE id = 'outlet-attachments' AND public = true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'auth_read_outlet_attachments') THEN
    CREATE POLICY auth_read_outlet_attachments ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'outlet-attachments');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'auth_write_outlet_attachments') THEN
    CREATE POLICY auth_write_outlet_attachments ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'outlet-attachments');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'auth_del_outlet_attachments') THEN
    CREATE POLICY auth_del_outlet_attachments ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'outlet-attachments');
  END IF;
END $$;

COMMIT;

-- Verifica: bucket privato, 3 policy
-- SELECT (SELECT public FROM storage.buckets WHERE id = 'outlet-attachments') AS pubblico,
--        (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'auth_%_outlet_attachments') AS policy;
