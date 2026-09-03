-- =============================================================================
-- ROLLBACK NZ_ONLY_170 — DWS 26VAL-0987: ripristina lo stato precedente dai backup
-- =============================================================================
BEGIN;

UPDATE public.payables p
   SET bank_transaction_id = b.bank_transaction_id,
       amount_paid = b.amount_paid,
       payment_date = b.payment_date,
       status = b.status
  FROM public._bkp_dws_rate_20260903 b
 WHERE p.id = b.id;

UPDATE public.bank_transactions bt
   SET reconciled_invoice_id = b.reconciled_invoice_id,
       is_reconciled = b.is_reconciled,
       reconciled_at = b.reconciled_at
  FROM public._bkp_dws_bt_20260903 b
 WHERE bt.id = b.id;

UPDATE public.reconciliation_log l
   SET status = b.status, notes = b.notes
  FROM public._bkp_dws_rlog_20260903 b
 WHERE l.id = b.id;

DELETE FROM public.reconciliation_log
 WHERE notes LIKE 'riallineamento 03/09/2026: SDD del %26VAL-0987%';

DELETE FROM public.payable_actions
 WHERE action_type = 'riallineamento_rate' AND note LIKE '%NZ_ONLY_170%';

COMMIT;
