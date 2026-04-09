-- Aggiunge colonna storage_bucket alla tabella documents
-- per tracciare in quale bucket Supabase è stato salvato il file
ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_bucket TEXT;

-- Aggiunge colonna outlet_id alla tabella contract_documents (se mancante)
ALTER TABLE contract_documents ADD COLUMN IF NOT EXISTS outlet_id UUID;
ALTER TABLE contract_documents ADD COLUMN IF NOT EXISTS category TEXT;
