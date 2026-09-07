-- =====================================================================
-- Migrazione 174 — Chiusura cassa: piu' spese cassa e una foto per riga
-- =====================================================================
-- RICHIESTA DI PATRIZIO (2026-09-04, dopo il primo giro sulla fase 1):
--   * le spese cassa non sono un solo importo con una descrizione, ma piu'
--     righe (ognuna con importo, descrizione e lo scontrino fotografato);
--   * le foto non vanno in un contenitore unico della giornata: ogni valore
--     ha la SUA foto (lo scontrino di chiusura per il totale, la chiusura POS
--     per ogni terminale, lo scontrino per ogni spesa, la ricevuta ATM per il
--     versamento). Cosi' la lettura automatica (fase 1b) sa a quale riga
--     riferire i numeri che legge.
--
-- COSA INTRODUCE:
--   * outlet_daily_closing_expenses — una riga per spesa cassa. Il campo
--     cash_expenses della chiusura resta ma diventa CALCOLATO (somma delle
--     righe) dal trigger, cosi' la pagina amministrativa e le quadrature non
--     cambiano; cash_expenses_note diventa l'elenco delle descrizioni.
--   * outlet_daily_closing_attachments: colonne target (a cosa si riferisce
--     la foto), line_id (canale) ed expense_id (spesa). Due nuovi tipi di
--     documento: scontrino_spesa e ricevuta_versamento.
--   * confirm_cash_closing: OBBLIGATORIA solo la foto dello scontrino di
--     chiusura (totale). Le altre (chiusura POS per terminale, scontrino di
--     ogni spesa, ricevuta del versamento) sono facoltative ma agganciate
--     alla singola riga; l'app avvisa che senza foto potra' essere chiesto
--     un chiarimento (decisione di Patrizio, 2026-09-04).
--
-- NO DATA LOSS: additiva. Nessuna chiusura esiste ancora nei 3 tenant
-- (verificato: 0 righe), quindi il cambio di semantica di cash_expenses non
-- tocca dati. Le foto gia' caricate (nessuna) avrebbero target='altro'.
--
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago, DOPO la 173.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Spese cassa: una riga per spesa
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outlet_daily_closing_expenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_id  uuid NOT NULL REFERENCES public.outlet_daily_closings(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  outlet_id   uuid NOT NULL REFERENCES public.outlets(id),
  amount      numeric(14,2) NOT NULL DEFAULT 0,
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outlet_daily_closing_expenses_closing
  ON public.outlet_daily_closing_expenses (closing_id, sort_order);

ALTER TABLE public.outlet_daily_closing_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY odce_select ON public.outlet_daily_closing_expenses
  FOR SELECT USING (company_id = public.get_my_company_id() AND public.has_outlet_access(outlet_id));
CREATE POLICY odce_write ON public.outlet_daily_closing_expenses
  FOR ALL USING (company_id = public.get_my_company_id()
                 AND public.can_write_cash_closing(outlet_id)
                 AND EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                             WHERE c.id = closing_id AND c.status = 'bozza'))
  WITH CHECK (company_id = public.get_my_company_id()
              AND public.can_write_cash_closing(outlet_id)
              AND EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                          WHERE c.id = closing_id AND c.status = 'bozza'));

REVOKE ALL ON public.outlet_daily_closing_expenses FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlet_daily_closing_expenses TO authenticated;
GRANT ALL ON public.outlet_daily_closing_expenses TO service_role;

-- Ogni modifica alle spese tocca la chiusura (stesso meccanismo delle righe canale).
DROP TRIGGER IF EXISTS trg_cash_closing_expenses_touch ON public.outlet_daily_closing_expenses;
CREATE TRIGGER trg_cash_closing_expenses_touch
  AFTER INSERT OR UPDATE OR DELETE ON public.outlet_daily_closing_expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_cash_closing_lines_touch();

-- La 172 blocca all'operatore di cassa ogni tabella fuori lista bianca:
-- questa tabella e' sua, quindi NON riceve cash_operator_block.

-- ---------------------------------------------------------------------
-- 2. Foto agganciate alla singola riga
-- ---------------------------------------------------------------------
ALTER TABLE public.outlet_daily_closing_attachments
  ADD COLUMN IF NOT EXISTS target text NOT NULL DEFAULT 'altro',
  ADD COLUMN IF NOT EXISTS line_id uuid REFERENCES public.outlet_daily_closing_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expense_id uuid REFERENCES public.outlet_daily_closing_expenses(id) ON DELETE SET NULL;

ALTER TABLE public.outlet_daily_closing_attachments
  DROP CONSTRAINT IF EXISTS outlet_daily_closing_attachments_target_check;
ALTER TABLE public.outlet_daily_closing_attachments
  ADD CONSTRAINT outlet_daily_closing_attachments_target_check
  CHECK (target IN ('totale', 'canale', 'spesa', 'versamento', 'altro'));

ALTER TABLE public.outlet_daily_closing_attachments
  DROP CONSTRAINT IF EXISTS outlet_daily_closing_attachments_kind_check;
ALTER TABLE public.outlet_daily_closing_attachments
  ADD CONSTRAINT outlet_daily_closing_attachments_kind_check
  CHECK (kind IN ('rt_chiusura', 'rt_rapporto_finanziario', 'rt_trasmissione', 'pos_chiusura',
                  'scontrino_spesa', 'ricevuta_versamento', 'altro'));

CREATE INDEX IF NOT EXISTS outlet_daily_closing_attachments_target
  ON public.outlet_daily_closing_attachments (closing_id, target);

COMMENT ON COLUMN public.outlet_daily_closing_attachments.target IS
  'A cosa si riferisce la foto: totale (scontrino di chiusura), canale (line_id), spesa (expense_id), versamento, altro.';

-- ---------------------------------------------------------------------
-- 3. Trigger di calcolo: le spese sono la somma delle righe
-- ---------------------------------------------------------------------
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

  -- Spese cassa = somma delle righe (migrazione 174); la nota e' l'elenco.
  SELECT COALESCE(SUM(e.amount), 0),
         NULLIF(string_agg(NULLIF(btrim(e.description), ''), ', ' ORDER BY e.sort_order), '')
  INTO v_expenses, v_expenses_note
  FROM public.outlet_daily_closing_expenses e
  WHERE e.closing_id = NEW.id;

  NEW.cash_expenses       := v_expenses;
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
    NEW.cash_float_expected := v_prev_float + v_cash_line - v_expenses - COALESCE(NEW.cash_deposit, 0);
    NEW.cash_difference := CASE WHEN NEW.cash_float_declared IS NULL THEN NULL
                                ELSE NEW.cash_float_declared - NEW.cash_float_expected END;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. Conferma: obbligatoria solo la foto del totale
-- ---------------------------------------------------------------------
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
    -- Totale: lo scontrino di chiusura del registratore.
    IF NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_attachments a
                   WHERE a.closing_id = c.id AND a.target = 'totale') THEN
      RAISE EXCEPTION 'Manca la foto dello scontrino di chiusura (totale corrispettivi)' USING ERRCODE = 'P0001';
    END IF;

    -- Le altre foto (chiusura POS per terminale, scontrino di ogni spesa,
    -- ricevuta del versamento) sono FACOLTATIVE: si agganciano alla riga e
    -- l'app avvisa che senza foto potra' essere chiesto un chiarimento.
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
--   SELECT count(*) FROM pg_policies WHERE tablename = 'outlet_daily_closing_expenses';   -- 2
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'outlet_daily_closing_attachments' AND column_name IN ('target','line_id','expense_id'); -- 3
