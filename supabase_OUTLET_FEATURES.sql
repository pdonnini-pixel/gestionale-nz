-- =====================================================
-- OUTLET FEATURES: Versioning + Audit Trail
-- Eseguire in Supabase SQL Editor
-- =====================================================

-- 1. Tabella versioni documenti
CREATE TABLE IF NOT EXISTS document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  document_table TEXT NOT NULL DEFAULT 'documents', -- 'documents', 'contract_documents', 'outlet_attachments'
  version_number INT NOT NULL DEFAULT 1,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  storage_bucket TEXT DEFAULT 'outlet-attachments',
  uploaded_by UUID,
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indice per lookup veloce
CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON document_versions(document_id, document_table);

-- 2. Aggiungi uploaded_by alle tabelle documenti esistenti
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='uploaded_by') THEN
    ALTER TABLE documents ADD COLUMN uploaded_by UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='uploaded_by_name') THEN
    ALTER TABLE documents ADD COLUMN uploaded_by_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contract_documents' AND column_name='uploaded_by') THEN
    ALTER TABLE contract_documents ADD COLUMN uploaded_by UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contract_documents' AND column_name='uploaded_by_name') THEN
    ALTER TABLE contract_documents ADD COLUMN uploaded_by_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='outlet_attachments' AND column_name='uploaded_by') THEN
    ALTER TABLE outlet_attachments ADD COLUMN uploaded_by UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='outlet_attachments' AND column_name='uploaded_by_name') THEN
    ALTER TABLE outlet_attachments ADD COLUMN uploaded_by_name TEXT;
  END IF;
END $$;

-- 3. RLS per document_versions
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'document_versions' AND policyname = 'doc_versions_all') THEN
    CREATE POLICY doc_versions_all ON document_versions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Fatto! Ora le tabelle supportano:
-- - Versioning: ogni upload salva la versione precedente in document_versions
-- - Audit trail: uploaded_by e uploaded_by_name tracciano chi ha caricato
