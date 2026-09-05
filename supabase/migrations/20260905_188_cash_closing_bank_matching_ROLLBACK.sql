-- ROLLBACK migrazione 188 — verifica chiusure di cassa con la banca
-- ⚠️ NO DATA LOSS: cancella gli abbinamenti e le colonne di esito. Solo dopo
-- backup e conferma binaria di Patrizio.
BEGIN;
SELECT cron.unschedule('cash-bank-matching-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cash-bank-matching-daily');
DROP FUNCTION IF EXISTS public.cash_bank_monthly_summary(integer, integer);
DROP FUNCTION IF EXISTS public.list_bank_terminal_codes(integer);
DROP FUNCTION IF EXISTS public.run_cash_bank_matching(integer);
DROP FUNCTION IF EXISTS public.match_cash_closings_with_bank(uuid, integer, numeric);
DROP FUNCTION IF EXISTS public.cash_bank_norm_code(text);
DROP FUNCTION IF EXISTS public.cash_bank_is_deposit(text);
DROP FUNCTION IF EXISTS public.cash_bank_ref_date(text);
DROP FUNCTION IF EXISTS public.cash_bank_circuit(text);
DROP FUNCTION IF EXISTS public.cash_bank_terminal_code(text);
DROP TABLE IF EXISTS public.closing_bank_matches;
ALTER TABLE public.outlet_daily_closings
  DROP COLUMN IF EXISTS deposit_bank_status, DROP COLUMN IF EXISTS deposit_bank_amount,
  DROP COLUMN IF EXISTS deposit_bank_transaction_id, DROP COLUMN IF EXISTS bank_verified_at;
ALTER TABLE public.outlet_daily_closing_lines
  DROP COLUMN IF EXISTS bank_status, DROP COLUMN IF EXISTS bank_amount, DROP COLUMN IF EXISTS bank_matched_at;
COMMIT;
