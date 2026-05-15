-- Migrazione 033 — VIEW cash_movements (compatibilità back-read)
-- La tabella reale cash_movements è stata droppata in 031 (single source = bank_transactions).
-- Questa VIEW permette al codice legacy di leggere senza crashare.
-- INSERT/UPDATE non sono supportate (è una VIEW non aggiornabile).

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
  bt.id AS bank_transaction_id
FROM public.bank_transactions bt;

GRANT SELECT ON public.cash_movements TO authenticated, service_role;

COMMENT ON VIEW public.cash_movements IS 'Compatibilità back-read: cash_movements ora è VIEW su bank_transactions (single source A-Cube). Drop tabella reale fatto in migration 031.';
