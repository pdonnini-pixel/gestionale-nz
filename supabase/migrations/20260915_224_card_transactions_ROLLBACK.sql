-- Rollback 224 — movimenti delle carte.
-- ATTENZIONE: DROP TABLE perde le righe importate dagli estratti carta
-- (ricostruibili reimportando i file dal bucket). Eseguire solo con
-- conferma esplicita di Patrizio (REGOLA NO DATA LOSS).
BEGIN;
ALTER TABLE public.bank_statements
  DROP COLUMN IF EXISTS settled_bank_transaction_id,
  DROP COLUMN IF EXISTS statement_total,
  DROP COLUMN IF EXISTS card_last4;
DROP TABLE IF EXISTS public.card_transactions;
COMMIT;
