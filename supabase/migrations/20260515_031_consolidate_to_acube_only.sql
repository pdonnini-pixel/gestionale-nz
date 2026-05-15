-- Migrazione 031 — Consolidamento single-source A-Cube
-- Drop tabelle legacy vuote (cash_movements, reconciliation_log, reconciliation_rejected_pairs,
-- payment_records, yapily_transactions) + drop conti manuali post-wipe (saldi 0).
-- Aggiunge bank_transaction_id su payables/electronic_invoices per riconciliazione Fase 2.

ALTER TABLE public.electronic_invoices DROP CONSTRAINT IF EXISTS electronic_invoices_cash_movement_id_fkey;
ALTER TABLE public.payables DROP CONSTRAINT IF EXISTS payables_cash_movement_id_fkey;

DROP TABLE IF EXISTS public.reconciliation_rejected_pairs CASCADE;
DROP TABLE IF EXISTS public.reconciliation_log CASCADE;
DROP TABLE IF EXISTS public.payment_records CASCADE;
DROP TABLE IF EXISTS public.yapily_transactions CASCADE;
DROP TABLE IF EXISTS public.cash_movements CASCADE;

ALTER TABLE public.electronic_invoices DROP COLUMN IF EXISTS cash_movement_id;
ALTER TABLE public.payables DROP COLUMN IF EXISTS cash_movement_id;

ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS bank_transaction_id UUID
  REFERENCES public.bank_transactions(id) ON DELETE SET NULL;
ALTER TABLE public.electronic_invoices ADD COLUMN IF NOT EXISTS bank_transaction_id UUID
  REFERENCES public.bank_transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payables_bank_transaction ON public.payables(bank_transaction_id) WHERE bank_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_einvoices_bank_transaction ON public.electronic_invoices(bank_transaction_id) WHERE bank_transaction_id IS NOT NULL;

DELETE FROM public.bank_accounts WHERE acube_account_uuid IS NULL;
