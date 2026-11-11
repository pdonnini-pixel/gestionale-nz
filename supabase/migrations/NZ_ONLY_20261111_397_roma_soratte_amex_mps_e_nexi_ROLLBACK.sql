-- =====================================================================
-- ROLLBACK della NZ_ONLY 397 — Roma Soratte: Amex MPS e contratto Nexi
-- ---------------------------------------------------------------------
-- I contratti non si cancellano (NO DATA LOSS): si spengono.
-- =====================================================================

BEGIN;

UPDATE public.acquirer_contracts a
   SET is_active = false, updated_at = now()
  FROM public.outlets o
 WHERE o.code = 'RSO' AND a.outlet_id = o.id
   AND (a.acquirer, a.merchant_code) IN (('amex', '7373035252'), ('nexi', 'LN0006099923'));

COMMIT;
