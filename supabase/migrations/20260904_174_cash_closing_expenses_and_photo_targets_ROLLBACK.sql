-- ROLLBACK migrazione 174 — spese cassa per riga e foto per riga
-- ⚠️ NO DATA LOSS: cancella le righe spesa e i riferimenti riga↔foto.
-- Solo dopo backup (SELECT * FROM outlet_daily_closing_expenses;
-- SELECT id, target, line_id, expense_id FROM outlet_daily_closing_attachments;)
-- e conferma binaria di Patrizio. Le funzioni tornano alla versione 173.

BEGIN;

ALTER TABLE public.outlet_daily_closing_attachments
  DROP CONSTRAINT IF EXISTS outlet_daily_closing_attachments_kind_check;
ALTER TABLE public.outlet_daily_closing_attachments
  ADD CONSTRAINT outlet_daily_closing_attachments_kind_check
  CHECK (kind IN ('rt_chiusura', 'rt_rapporto_finanziario', 'rt_trasmissione', 'pos_chiusura', 'altro'));
ALTER TABLE public.outlet_daily_closing_attachments
  DROP CONSTRAINT IF EXISTS outlet_daily_closing_attachments_target_check,
  DROP COLUMN IF EXISTS target,
  DROP COLUMN IF EXISTS line_id,
  DROP COLUMN IF EXISTS expense_id;

DROP TRIGGER IF EXISTS trg_cash_closing_expenses_touch ON public.outlet_daily_closing_expenses;
DROP TABLE IF EXISTS public.outlet_daily_closing_expenses;

-- fn_cash_closing_compute e confirm_cash_closing: ripristinare le
-- definizioni della migrazione 173 (sezioni 5 e 7).

COMMIT;
