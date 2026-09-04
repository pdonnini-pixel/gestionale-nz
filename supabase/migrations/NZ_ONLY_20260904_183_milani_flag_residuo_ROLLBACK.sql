-- ROLLBACK NZ_ONLY 183 — riaccende il flag come era.
BEGIN;
UPDATE public.payables p SET
  closed_manually = b.closed_manually, manual_close_reason = b.manual_close_reason, notes = b.notes
FROM public._bkp_milani26a_20260904 b WHERE p.id = b.id;
COMMIT;
