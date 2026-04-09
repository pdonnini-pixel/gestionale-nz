-- =====================================================
-- Tabella: contract_documents
-- Bucket:  contract-documents
-- Esegui questo SQL nel Supabase SQL Editor
-- =====================================================

-- 1) Crea tabella per i metadati dei documenti allegati ai contratti
CREATE TABLE IF NOT EXISTS contract_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT,            -- path nel bucket storage
  file_size BIGINT,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indice per query rapide per contratto
CREATE INDEX IF NOT EXISTS idx_contract_documents_contract
  ON contract_documents(contract_id);

-- RLS
ALTER TABLE contract_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read contract_documents"
  ON contract_documents FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert contract_documents"
  ON contract_documents FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete contract_documents"
  ON contract_documents FOR DELETE
  TO authenticated
  USING (true);

-- 2) Crea bucket Storage (se non esiste già)
INSERT INTO storage.buckets (id, name, public)
VALUES ('contract-documents', 'contract-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Policy storage: lettura per utenti autenticati
CREATE POLICY "Auth read contract-documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'contract-documents');

-- Policy storage: upload per utenti autenticati
CREATE POLICY "Auth upload contract-documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'contract-documents');

-- Policy storage: delete per utenti autenticati
CREATE POLICY "Auth delete contract-documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'contract-documents');

-- =====================================================
-- Tabella: import_documents (per ImportHub)
-- =====================================================

CREATE TABLE IF NOT EXISTS import_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  file_name TEXT NOT NULL,
  file_path TEXT,
  file_size BIGINT,
  file_type TEXT,            -- 'pdf', 'csv', 'xlsx', 'xml'
  source TEXT DEFAULT 'manuale',
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE import_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read import_documents"
  ON import_documents FOR SELECT TO authenticated USING (true);

CREATE POLICY "Auth insert import_documents"
  ON import_documents FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Auth delete import_documents"
  ON import_documents FOR DELETE TO authenticated USING (true);
