-- =============================================================================
-- ROLLBACK NZ_ONLY 182 — le 7 NEXI tornano da pagare
-- =============================================================================
BEGIN;

UPDATE public.bank_transactions bt
SET is_reconciled = false, reconciled_at = NULL, reconciled_invoice_id = NULL
FROM public.payables p
WHERE p.bank_transaction_id = bt.id
  AND p.supplier_name ILIKE '%NEXI%'
  AND p.invoice_number IN ('3214540','3214541','3214542','3214543','3214544','3214545','3214546');

UPDATE public.payables
SET bank_transaction_id = NULL, amount_paid = 0, payment_date = NULL, updated_at = now()
WHERE supplier_name ILIKE '%NEXI%'
  AND invoice_number IN ('3214540','3214541','3214542','3214543','3214544','3214545','3214546');

DELETE FROM public.reconciliation_log
WHERE notes LIKE 'ricerca estesa 04/09/2026: blocco di 7 addebiti SDD NEXI%';

COMMIT;
