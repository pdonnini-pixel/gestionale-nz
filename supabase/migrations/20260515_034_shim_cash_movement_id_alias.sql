-- Migrazione 034 — Shim back-compat: ri-aggiungo cash_movement_id come alias generato di bank_transaction_id
-- per non rompere il frontend (5 file usano ancora cash_movement_id):
--   - pages/ScadenzarioSmart.tsx
--   - pages/Banche.tsx
--   - pages/TesoreriaManuale.tsx
--   - pages/Fornitori.tsx
--   - lib/reconciliationEngine.ts
-- Refactor totale frontend per puntare bank_transaction_id rimane nel backlog.
-- La colonna è generated STORED come copy di bank_transaction_id, niente trigger overhead.

ALTER TABLE public.payables
  ADD COLUMN IF NOT EXISTS cash_movement_id UUID GENERATED ALWAYS AS (bank_transaction_id) STORED;

ALTER TABLE public.electronic_invoices
  ADD COLUMN IF NOT EXISTS cash_movement_id UUID GENERATED ALWAYS AS (bank_transaction_id) STORED;

COMMENT ON COLUMN public.payables.cash_movement_id IS 'DEPRECATED — alias generato di bank_transaction_id per back-compat frontend. Refactor in backlog.';
COMMENT ON COLUMN public.electronic_invoices.cash_movement_id IS 'DEPRECATED — alias generato di bank_transaction_id per back-compat frontend. Refactor in backlog.';
