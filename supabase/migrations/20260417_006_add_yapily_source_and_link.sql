-- ============================================================
-- Fase 2.4 — Link Yapily → cash_movements
-- Aggiunge source api_yapily e colonna yapily_transaction_id
-- Applicata su Supabase: 2026-04-17
-- ============================================================

-- 1. Aggiungere api_yapily all'enum import_source
ALTER TYPE import_source ADD VALUE IF NOT EXISTS 'api_yapily';

-- 2. Aggiungere colonna per linkare il movimento Yapily originale
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS yapily_transaction_id UUID REFERENCES yapily_transactions(id);

-- 3. Indice unico per evitare duplicati e velocizzare lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_movements_yapily_tx
ON cash_movements(yapily_transaction_id) WHERE yapily_transaction_id IS NOT NULL;
