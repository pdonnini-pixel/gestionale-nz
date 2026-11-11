-- =====================================================================
-- ROLLBACK della NZ_ONLY 388 — Roma Soratte: codice Amex e pay by link
-- ---------------------------------------------------------------------
-- Il contratto Amex non si cancella (NO DATA LOSS): si spegne.
-- Il pay by link di Roma torna canale a se', com'era prima.
-- =====================================================================

BEGIN;

UPDATE public.acquirer_contracts a
   SET is_active = false, updated_at = now()
  FROM public.outlets o
 WHERE o.code = 'RSO' AND a.outlet_id = o.id
   AND a.acquirer = 'amex' AND a.merchant_code = '6830043717';

UPDATE public.outlet_payment_channels c
   SET kind = 'paybylink', terminal_code = NULL, bank_account_id = NULL,
       bank_tolerance_pct = 0, updated_at = now()
  FROM public.outlets o
 WHERE o.code = 'RSO' AND c.outlet_id = o.id AND c.label = 'Pay by link';

COMMIT;
