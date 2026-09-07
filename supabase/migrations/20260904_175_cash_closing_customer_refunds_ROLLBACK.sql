-- ROLLBACK migrazione 175 — rimborso a cliente
-- ⚠️ NO DATA LOSS: rimuove la distinzione spesa/rimborso e la colonna
-- customer_refunds. Solo dopo backup e conferma binaria di Patrizio.
-- Le funzioni tornano alla versione 174.

BEGIN;

ALTER TABLE public.outlet_daily_closing_expenses
  DROP CONSTRAINT IF EXISTS outlet_daily_closing_expenses_kind_check,
  DROP COLUMN IF EXISTS kind;
ALTER TABLE public.outlet_daily_closings
  DROP COLUMN IF EXISTS customer_refunds;

-- fn_cash_closing_compute e confirm_cash_closing: ripristinare le
-- definizioni della migrazione 174.

COMMIT;
