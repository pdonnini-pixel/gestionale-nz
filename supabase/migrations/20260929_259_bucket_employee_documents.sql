-- =====================================================================
-- 259 — Bucket «employee-documents» su tutti e 3 i tenant
-- =====================================================================
-- La pagina Dipendenti carica cedolini e documenti del rapporto (contratti,
-- proroghe, trasformazioni) nel bucket privato «employee-documents».
-- Al 29/09/2026 il bucket esisteva solo su NZ: su Made e Zago ogni
-- caricamento falliva. Qui si crea dove manca, con le stesse tre regole
-- di NZ (lettura, scrittura, cancellazione per utenti autenticati; il
-- tenant e' fisico, un progetto per azienda).
-- Idempotente: su NZ non cambia niente.
-- =====================================================================
BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-documents', 'employee-documents', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'auth_read_employee_documents') THEN
    CREATE POLICY auth_read_employee_documents ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'employee-documents');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'auth_write_employee_documents') THEN
    CREATE POLICY auth_write_employee_documents ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'employee-documents');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'auth_del_employee_documents') THEN
    CREATE POLICY auth_del_employee_documents ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'employee-documents');
  END IF;
END $$;

COMMIT;

-- Verifica: 1 bucket, 3 policy
-- SELECT (SELECT count(*) FROM storage.buckets WHERE id = 'employee-documents') AS bucket,
--        (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'auth_%_employee_documents') AS policy;
