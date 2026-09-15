-- ROLLBACK NZ_ONLY 182 — riporta la riga Spm 31 allo stato precedente.
BEGIN;

UPDATE public.payables p SET
  amount_paid = b.amount_paid, payment_date = b.payment_date,
  closed_manually = b.closed_manually, manual_close_reason = b.manual_close_reason,
  status = b.status, notes = b.notes
FROM public._bkp_spm31_20260904 b WHERE p.id = b.id;

DELETE FROM public.payable_actions WHERE operator_name = 'Fix Spm 31 04/09';

COMMIT;
