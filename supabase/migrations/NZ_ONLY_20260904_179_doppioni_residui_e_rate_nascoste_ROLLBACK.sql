-- =============================================================================
-- ROLLBACK NZ_ONLY 179 — riporta le 7 righe allo stato precedente, dal backup.
-- =============================================================================

BEGIN;

UPDATE public.payables p SET
  status = b.status, amount_paid = b.amount_paid, payment_date = b.payment_date,
  closed_manually = b.closed_manually, is_provisional_paid = b.is_provisional_paid,
  is_placeholder = b.is_placeholder, notes = b.notes
FROM public._bkp_doppioni_20260904 b
WHERE p.id = b.id;

DELETE FROM public.payable_actions WHERE operator_name = 'Fix doppioni 04/09';

COMMIT;
