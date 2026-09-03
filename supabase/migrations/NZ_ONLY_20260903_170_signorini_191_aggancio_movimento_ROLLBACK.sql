-- ROLLBACK NZ_ONLY_20260903_170 — scollega il bonifico 06/03/2026 dalla fattura 191.
-- Riporta payment_date al valore precedente (08/04/2026, dal file di verifica).
BEGIN;

UPDATE public.payables
   SET bank_transaction_id = NULL,
       payment_date = DATE '2026-04-08',
       updated_at = now()
 WHERE id = '25fa0551-6b80-40c2-bd73-26d5d5796f36'
   AND bank_transaction_id = '015f78a4-cdcc-418a-ac89-8aa235acdbe7';

UPDATE public.bank_transactions
   SET is_reconciled = false, reconciled_at = NULL, reconciled_invoice_id = NULL
 WHERE id = '015f78a4-cdcc-418a-ac89-8aa235acdbe7';

UPDATE public.reconciliation_log
   SET status = 'rejected'
 WHERE bank_transaction_id = '015f78a4-cdcc-418a-ac89-8aa235acdbe7'
   AND payable_id = '25fa0551-6b80-40c2-bd73-26d5d5796f36'
   AND match_type = 'manual' AND status = 'applied';

COMMIT;
