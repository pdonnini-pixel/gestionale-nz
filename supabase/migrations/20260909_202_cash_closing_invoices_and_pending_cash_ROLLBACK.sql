-- ROLLBACK 202 — ripristina la formula della migration 175 (le colonne restano: sono additive,
-- rimuoverle sarebbe un'operazione distruttiva da confermare a parte).
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_cash_closing_compute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_channels_total numeric(14,2) := 0;
  v_cash_line      numeric(14,2) := 0;
  v_expenses       numeric(14,2) := 0;
  v_refunds        numeric(14,2) := 0;
  v_expenses_note  text;
  v_prev_float     numeric(14,2);
BEGIN
  IF NEW.is_closed_day THEN
    NEW.total_receipts := 0;
    NEW.cash_deposit   := COALESCE(NEW.cash_deposit, 0);
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN ch.counts_in_total THEN l.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ch.kind = 'contanti' THEN l.amount ELSE 0 END), 0)
  INTO v_channels_total, v_cash_line
  FROM public.outlet_daily_closing_lines l
  JOIN public.outlet_payment_channels ch ON ch.id = l.channel_id
  WHERE l.closing_id = NEW.id;

  SELECT COALESCE(SUM(CASE WHEN e.kind = 'spesa' THEN e.amount ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN e.kind = 'rimborso_cliente' THEN e.amount ELSE 0 END), 0),
         NULLIF(string_agg(NULLIF(btrim(e.description), ''), ', ' ORDER BY e.sort_order)
                FILTER (WHERE e.kind = 'spesa'), '')
  INTO v_expenses, v_refunds, v_expenses_note
  FROM public.outlet_daily_closing_expenses e
  WHERE e.closing_id = NEW.id;

  NEW.cash_expenses       := v_expenses;
  NEW.customer_refunds    := v_refunds;
  NEW.cash_expenses_note  := v_expenses_note;
  NEW.channels_total      := v_channels_total;
  NEW.receipts_difference := COALESCE(NEW.total_receipts, 0) - v_channels_total;

  SELECT c.cash_float_declared INTO v_prev_float
  FROM public.outlet_daily_closings c
  WHERE c.outlet_id = NEW.outlet_id
    AND c.closing_date < NEW.closing_date
    AND c.status IN ('confermata', 'verificata')
    AND c.cash_float_declared IS NOT NULL
  ORDER BY c.closing_date DESC
  LIMIT 1;

  v_prev_float := COALESCE(v_prev_float, NEW.cash_float_opening);
  IF v_prev_float IS NULL THEN
    NEW.cash_float_expected := NULL;
    NEW.cash_difference     := NULL;
  ELSE
    NEW.cash_float_expected := v_prev_float + v_cash_line - v_expenses - v_refunds - COALESCE(NEW.cash_deposit, 0);
    NEW.cash_difference := CASE WHEN NEW.cash_float_declared IS NULL THEN NULL
                                ELSE NEW.cash_float_declared - NEW.cash_float_expected END;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

UPDATE public.outlet_daily_closings SET updated_at = now() WHERE closing_date >= '2026-09-01';

COMMIT;
