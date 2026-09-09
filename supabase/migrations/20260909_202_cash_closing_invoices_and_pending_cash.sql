-- 202 — Chiusura cassa: nuovo modello di quadratura
--
-- Blocco 1: corrispettivi + fatture = totale incassato = contanti + POS + pay by link + bonifico
--   (le righe di canale kind='fattura' NON sono un mezzo di pagamento: si sommano ai corrispettivi).
-- Contante: la partenza di stasera è il fondo cassa contato ieri sera + i contanti ancora da versare
--   contati ieri sera; si aggiungono i contanti dei corrispettivi, si tolgono spese cassa, rimborsi
--   e il versamento del giorno. Il negozio conta separatamente il fondo cassa e i contanti ancora
--   da versare; la differenza di cassa è (fondo contato + da versare contati) − contante atteso.
--
-- Applicata via MCP su NZ → Made → Zago il 2026-09-09. Additiva: nessuna colonna rimossa.
BEGIN;

ALTER TABLE public.outlet_daily_closings
  ADD COLUMN IF NOT EXISTS invoices_total        numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_pending_opening  numeric(14,2),
  ADD COLUMN IF NOT EXISTS cash_pending_declared numeric(14,2);

COMMENT ON COLUMN public.outlet_daily_closings.invoices_total IS
  'Somma delle righe di canale kind=fattura: si aggiunge ai corrispettivi (totale incassato), non ai mezzi di pagamento';
COMMENT ON COLUMN public.outlet_daily_closings.cash_pending_opening IS
  'Contanti ancora da versare di ieri, scritti solo alla prima chiusura del negozio (poi presi dalla chiusura precedente)';
COMMENT ON COLUMN public.outlet_daily_closings.cash_pending_declared IS
  'Contanti ancora da versare contati stasera (separati dal fondo cassa)';

CREATE OR REPLACE FUNCTION public.fn_cash_closing_compute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_channels_total numeric(14,2) := 0;
  v_cash_line      numeric(14,2) := 0;
  v_invoices       numeric(14,2) := 0;
  v_expenses       numeric(14,2) := 0;
  v_refunds        numeric(14,2) := 0;
  v_expenses_note  text;
  v_prev_float     numeric(14,2);
  v_prev_pending   numeric(14,2);
BEGIN
  IF NEW.is_closed_day THEN
    NEW.total_receipts := 0;
    NEW.cash_deposit   := COALESCE(NEW.cash_deposit, 0);
  END IF;

  -- Mezzi di pagamento (senza le fatture), contanti, fatture
  SELECT
    COALESCE(SUM(CASE WHEN ch.counts_in_total AND ch.kind <> 'fattura' THEN l.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ch.kind = 'contanti' THEN l.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ch.kind = 'fattura' THEN l.amount ELSE 0 END), 0)
  INTO v_channels_total, v_cash_line, v_invoices
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
  NEW.invoices_total      := v_invoices;
  NEW.channels_total      := v_channels_total;
  -- corrispettivi + fatture = totale incassato = somma dei mezzi di pagamento
  NEW.receipts_difference := COALESCE(NEW.total_receipts, 0) + v_invoices - v_channels_total;

  -- Partenza di stasera: fondo e contanti da versare dell'ultima chiusura confermata
  -- con il fondo contato; se non c'e', i valori iniziali scritti alla prima chiusura.
  SELECT c.cash_float_declared, COALESCE(c.cash_pending_declared, 0)
  INTO v_prev_float, v_prev_pending
  FROM public.outlet_daily_closings c
  WHERE c.outlet_id = NEW.outlet_id
    AND c.closing_date < NEW.closing_date
    AND c.status IN ('confermata', 'verificata')
    AND c.cash_float_declared IS NOT NULL
  ORDER BY c.closing_date DESC
  LIMIT 1;

  IF v_prev_float IS NULL THEN
    v_prev_float   := NEW.cash_float_opening;
    v_prev_pending := COALESCE(NEW.cash_pending_opening, 0);
  END IF;

  IF v_prev_float IS NULL THEN
    NEW.cash_float_expected := NULL;
    NEW.cash_difference     := NULL;
  ELSE
    NEW.cash_float_expected := v_prev_float + COALESCE(v_prev_pending, 0) + v_cash_line - v_expenses - v_refunds - COALESCE(NEW.cash_deposit, 0);
    NEW.cash_difference := CASE WHEN NEW.cash_float_declared IS NULL THEN NULL
                                ELSE NEW.cash_float_declared + COALESCE(NEW.cash_pending_declared, 0) - NEW.cash_float_expected END;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Ricalcolo dei campi derivati delle chiusure del mese corrente (il trigger BEFORE UPDATE
-- rifà i conti con la nuova formula; nessun dato inserito dall'utente viene toccato).
UPDATE public.outlet_daily_closings SET updated_at = now() WHERE closing_date >= '2026-09-01';

COMMIT;

-- Verifica:
-- SELECT closing_date, total_receipts, invoices_total, channels_total, receipts_difference,
--        cash_float_expected, cash_float_declared, cash_pending_declared, cash_difference
-- FROM public.outlet_daily_closings WHERE closing_date >= '2026-09-01' ORDER BY closing_date, outlet_id;
