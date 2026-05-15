-- Migrazione 035 — Fix collateral del consolidamento single-source A-Cube
-- 1. Ricreo v_cash_position (droppata da CASCADE di 031, era VIEW su cash_movements)
-- 2. Estendo VIEW cash_movements con cost_category_id e ai_category_id (sempre NULL, per back-compat)

CREATE OR REPLACE VIEW public.v_cash_position
WITH (security_invoker = on)
AS
SELECT
  ba.company_id,
  sum(coalesce(ba.current_balance, 0)) AS current_balance,
  count(*) AS account_count,
  max(ba.balance_updated_at) AS last_updated_at
FROM public.bank_accounts ba
WHERE coalesce(ba.is_active, true) = true
GROUP BY ba.company_id;

GRANT SELECT ON public.v_cash_position TO authenticated, service_role;

CREATE OR REPLACE VIEW public.cash_movements
WITH (security_invoker = on)
AS
SELECT
  bt.id,
  bt.company_id,
  bt.bank_account_id,
  bt.transaction_date AS date,
  CASE WHEN bt.amount < 0 THEN 'uscita'::transaction_type ELSE 'entrata'::transaction_type END AS type,
  abs(bt.amount) AS amount,
  bt.description,
  bt.reference,
  bt.category,
  bt.supplier_id,
  bt.invoice_id AS payable_id,
  COALESCE(bt.is_reconciled, false) AS is_reconciled,
  bt.reconciled_invoice_id AS reconciled_with,
  bt.created_at,
  bt.id AS bank_transaction_id,
  NULL::uuid AS cost_category_id,
  NULL::uuid AS ai_category_id
FROM public.bank_transactions bt;

GRANT SELECT ON public.cash_movements TO authenticated, service_role;
