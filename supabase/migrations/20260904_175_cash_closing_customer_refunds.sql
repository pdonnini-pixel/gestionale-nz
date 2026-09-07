-- =====================================================================
-- Migrazione 175 — Chiusura cassa: rimborso a cliente
-- =====================================================================
-- RICHIESTA DI PATRIZIO (2026-09-04): oltre alle spese cassa serve la voce
-- "rimborso a cliente", con una nota di spiegazione obbligatoria e SENZA foto.
--
-- COSA INTRODUCE:
--   * outlet_daily_closing_expenses.kind: 'spesa' (default, con scontrino
--     fotografabile) oppure 'rimborso_cliente' (solo importo + nota).
--   * outlet_daily_closings.customer_refunds: somma dei rimborsi del giorno,
--     calcolata dal trigger come cash_expenses (che resta la somma delle sole
--     spese). Entrambi riducono il fondo cassa atteso:
--       fondo atteso = fondo di ieri + contanti − spese − rimborsi − versamento
--   * confirm_cash_closing: un rimborso senza nota blocca la conferma.
--
-- NO DATA LOSS: additiva (colonne con default, nessuna riga toccata).
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago, DOPO la 174.
-- =====================================================================

BEGIN;

ALTER TABLE public.outlet_daily_closing_expenses
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'spesa';
ALTER TABLE public.outlet_daily_closing_expenses
  DROP CONSTRAINT IF EXISTS outlet_daily_closing_expenses_kind_check;
ALTER TABLE public.outlet_daily_closing_expenses
  ADD CONSTRAINT outlet_daily_closing_expenses_kind_check
  CHECK (kind IN ('spesa', 'rimborso_cliente'));

ALTER TABLE public.outlet_daily_closings
  ADD COLUMN IF NOT EXISTS customer_refunds numeric(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.outlet_daily_closings.customer_refunds IS
  'Somma dei rimborsi a cliente pagati in contanti (righe kind=rimborso_cliente), calcolata dal trigger.';

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

  -- Spese cassa e rimborsi a cliente: somme delle righe (migrazioni 174-175).
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

CREATE OR REPLACE FUNCTION public.confirm_cash_closing(p_closing_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c        public.outlet_daily_closings%ROWTYPE;
  v_note   text;
BEGIN
  SELECT * INTO c FROM public.outlet_daily_closings WHERE id = p_closing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chiusura non trovata' USING ERRCODE = 'P0002'; END IF;
  IF c.company_id <> public.get_my_company_id() OR NOT public.can_write_cash_closing(c.outlet_id) THEN
    RAISE EXCEPTION 'Non autorizzato a confermare questa chiusura' USING ERRCODE = '42501';
  END IF;
  IF c.status <> 'bozza' THEN
    RAISE EXCEPTION 'La chiusura e'' gia'' confermata' USING ERRCODE = 'P0001';
  END IF;

  IF NOT c.is_closed_day THEN
    -- Unica foto obbligatoria: lo scontrino di chiusura del registratore.
    IF NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_attachments a
                   WHERE a.closing_id = c.id AND a.target = 'totale') THEN
      RAISE EXCEPTION 'Manca la foto dello scontrino di chiusura (totale corrispettivi)' USING ERRCODE = 'P0001';
    END IF;
    -- Un rimborso a cliente senza spiegazione non si conferma.
    IF EXISTS (SELECT 1 FROM public.outlet_daily_closing_expenses e
               WHERE e.closing_id = c.id AND e.kind = 'rimborso_cliente'
                 AND NULLIF(btrim(COALESCE(e.description, '')), '') IS NULL) THEN
      RAISE EXCEPTION 'Ogni rimborso a cliente deve avere una nota di spiegazione' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, c.notes, '')), '');
  IF c.receipts_difference <> 0 AND v_note IS NULL THEN
    RAISE EXCEPTION 'Il totale non quadra con i mezzi di pagamento: serve una nota per confermare' USING ERRCODE = 'P0001';
  END IF;
  IF c.cash_difference IS NOT NULL AND c.cash_difference <> 0 AND v_note IS NULL THEN
    RAISE EXCEPTION 'Il fondo cassa contato non coincide con l''atteso: serve una nota per confermare' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.outlet_daily_closings
     SET status = 'confermata', notes = v_note, confirmed_at = now(), confirmed_by = auth.uid()
   WHERE id = c.id;

  UPDATE public.outlet_daily_closings
     SET updated_at = now()
   WHERE outlet_id = c.outlet_id AND closing_date > c.closing_date AND status = 'bozza';

  PERFORM public.project_cash_closing_to_daily_revenue(c.id);

  SELECT * INTO c FROM public.outlet_daily_closings WHERE id = p_closing_id;
  RETURN jsonb_build_object(
    'id', c.id, 'status', c.status, 'total_receipts', c.total_receipts,
    'channels_total', c.channels_total, 'receipts_difference', c.receipts_difference,
    'cash_float_expected', c.cash_float_expected, 'cash_difference', c.cash_difference);
END;
$$;

COMMIT;

-- VERIFICA:
--   SELECT column_name FROM information_schema.columns
--    WHERE (table_name='outlet_daily_closing_expenses' AND column_name='kind')
--       OR (table_name='outlet_daily_closings' AND column_name='customer_refunds');  -- 2
