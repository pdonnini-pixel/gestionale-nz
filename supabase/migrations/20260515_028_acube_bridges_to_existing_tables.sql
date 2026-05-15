-- Migrazione 028 — Ponti A-Cube → tabelle esistenti UI (schema modifications)

ALTER TYPE import_source ADD VALUE IF NOT EXISTS 'api_acube_ob';
ALTER TYPE import_source ADD VALUE IF NOT EXISTS 'api_acube_sdi';

ALTER TABLE public.bank_accounts ADD COLUMN IF NOT EXISTS acube_account_uuid UUID UNIQUE;
ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS acube_dedup_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_tx_acube_dedup ON public.bank_transactions(acube_dedup_hash) WHERE acube_dedup_hash IS NOT NULL;
ALTER TABLE public.electronic_invoices ADD COLUMN IF NOT EXISTS acube_uuid UUID UNIQUE;
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS acube_uuid UUID UNIQUE;
