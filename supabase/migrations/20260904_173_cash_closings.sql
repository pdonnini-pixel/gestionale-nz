-- =====================================================================
-- Migrazione 173 — Chiusura di cassa giornaliera per outlet (specchietto incassi)
-- =====================================================================
-- COSA MANCAVA: gli incassi di ogni negozio vivevano in un foglio Excel
-- (SPECCHIETTI_INCASSI: una riga al giorno con totale corrispettivi, contanti,
-- POS per banca, pay by link, fatture, bonifici, spese cassa, versamenti,
-- fondo cassa). Nel gestionale `daily_revenue` esisteva ma era vuota e senza
-- alcun form; i ricavi mensili venivano ribattuti a mano in budget_confronto.
--
-- COSA INTRODUCE (analisi: SPECCHIETTO_INCASSI_ANALISI.md):
--   * outlet_payment_channels — i "canali di incasso" configurati per outlet
--     (Contanti, POS MPS, POS BCC Amex, Pay by link, ...). Sostituiscono le
--     colonne fisse dell'Excel: ogni tenant ha banche e terminali propri, e
--     un canale in piu' non deve richiedere una migration.
--   * outlet_daily_closings — una riga per outlet e giorno: totale battuto in
--     cassa, spese cassa, versamento, fondo cassa contato; i campi calcolati
--     (somma canali, differenza di quadratura, fondo cassa atteso, differenza
--     di cassa) li mantiene il trigger fn_cash_closing_compute.
--   * outlet_daily_closing_lines — un importo per canale (le colonne
--     dell'Excel diventano righe).
--   * outlet_daily_closing_attachments — le FOTO degli scontrini di chiusura
--     (registratore telematico, trasmissione AdE, chiusura POS), nel bucket
--     privato 'cash-closings'. Le foto sono OBBLIGATORIE per confermare
--     (scelta di Patrizio, 2026-09-04), salvo "negozio chiuso".
--
-- FLUSSO: la cassiera (ruolo operatore_cassa, migrazione 172) compila la
-- bozza, allega le foto e conferma con confirm_cash_closing(). La conferma
-- proietta il giorno in daily_revenue (lordo, contanti, carte, altro, netto
-- IVA) cosi' le pagine che gia' leggono daily_revenue (Outlet, Dashboard,
-- Cashflow, Margini, Fatturazione) si popolano senza modifiche. Dopo la
-- conferma il giorno e' in sola lettura: lo riapre solo super_advisor o
-- contabile (reopen_cash_closing), la cassiera puo' chiederlo
-- (request_cash_closing_reopen → notifica in-app).
--
-- QUADRATURE (le due regole dell'Excel rese esplicite):
--   totale corrispettivi = somma dei canali che "contano nel totale"
--   fondo cassa atteso   = fondo di ieri (ultima chiusura confermata) +
--                          contanti di oggi − spese cassa − versamento
--
-- NO DATA LOSS: migrazione additiva. Nessuna policy DELETE sulle chiusure:
-- una chiusura sbagliata si riapre e si corregge, non si cancella. Le foto
-- non si cancellano dopo la conferma. Le tabelle esistenti non vengono
-- toccate (daily_revenue riceve solo upsert per (company, outlet, giorno)).
--
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago (3 project_id), DOPO la 172.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Helper: chi puo' SCRIVERE la chiusura di un outlet
--    super_advisor e contabile sempre; operatore_cassa solo sul proprio
--    outlet (riga in user_outlet_access con can_write).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_write_cash_closing(p_outlet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND (
        up.role::text IN ('super_advisor', 'contabile')
        OR (up.role::text = 'operatore_cassa' AND EXISTS (
          SELECT 1 FROM public.user_outlet_access uoa
          WHERE uoa.user_id = auth.uid()
            AND uoa.outlet_id = p_outlet_id
            AND uoa.can_write = true
        ))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_write_cash_closing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_write_cash_closing(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. Canali di incasso per outlet
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outlet_payment_channels (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id),
  outlet_id        uuid NOT NULL REFERENCES public.outlets(id),
  -- Etichetta come appare alla cassiera ("POS MPS", "Pay by link").
  label            text NOT NULL,
  kind             text NOT NULL
                   CHECK (kind IN ('contanti', 'pos', 'pos_amex', 'paybylink', 'fattura', 'bonifico', 'altro')),
  -- Conto su cui accredita (NULL per i contanti). Fase 3: matching bancario.
  bank_account_id  uuid REFERENCES public.bank_accounts(id),
  -- Identificativo del terminale nella causale di accredito in banca
  -- (es. COD.SIA 6181087-00002) e TML stampato sulla chiusura POS.
  terminal_code    text,
  pos_terminal_id  text,
  settlement_days  integer NOT NULL DEFAULT 1,
  -- Se false l'importo non concorre al totale corrispettivi (es. fatture
  -- gia' comprese altrove): decisione per canale, non per tenant.
  counts_in_total  boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outlet_id, label)
);

COMMENT ON TABLE public.outlet_payment_channels IS
  'Canali di incasso configurati per outlet (colonne dello specchietto incassi). Un canale si disattiva, non si cancella.';

CREATE INDEX IF NOT EXISTS outlet_payment_channels_outlet
  ON public.outlet_payment_channels (company_id, outlet_id, sort_order);

-- ---------------------------------------------------------------------
-- 2. Chiusure giornaliere
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outlet_daily_closings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.companies(id),
  outlet_id            uuid NOT NULL REFERENCES public.outlets(id),
  closing_date         date NOT NULL,
  status               text NOT NULL DEFAULT 'bozza'
                       CHECK (status IN ('bozza', 'confermata', 'verificata')),
  -- Negozio chiuso: giornata a zero, foto non richieste, il mese non ha buchi.
  is_closed_day        boolean NOT NULL DEFAULT false,
  -- Totale battuto in cassa (lordo IVA), come sullo scontrino di chiusura.
  total_receipts       numeric(14,2) NOT NULL DEFAULT 0,
  -- Calcolati dal trigger: somma canali e differenza di quadratura.
  channels_total       numeric(14,2) NOT NULL DEFAULT 0,
  receipts_difference  numeric(14,2) NOT NULL DEFAULT 0,
  cash_expenses        numeric(14,2) NOT NULL DEFAULT 0,
  cash_expenses_note   text,
  cash_deposit         numeric(14,2) NOT NULL DEFAULT 0,
  cash_deposit_note    text,
  -- Fondo iniziale: usato SOLO quando non esiste una chiusura confermata
  -- precedente per l'outlet (primo giorno). Poi il fondo di ieri e' il
  -- fondo contato dell'ultima chiusura confermata.
  cash_float_opening   numeric(14,2),
  cash_float_expected  numeric(14,2),
  cash_float_declared  numeric(14,2),
  cash_difference      numeric(14,2),
  closed_by_name       text,
  notes                text,
  created_by           uuid,
  confirmed_at         timestamptz,
  confirmed_by         uuid,
  reopened_at          timestamptz,
  reopened_by          uuid,
  reopen_reason        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, outlet_id, closing_date)
);

COMMENT ON TABLE public.outlet_daily_closings IS
  'Chiusura di cassa giornaliera per outlet (specchietto incassi). Stati: bozza → confermata → verificata (con la banca, fase 3).';

CREATE INDEX IF NOT EXISTS outlet_daily_closings_outlet_date
  ON public.outlet_daily_closings (company_id, outlet_id, closing_date DESC);

-- ---------------------------------------------------------------------
-- 3. Importi per canale
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outlet_daily_closing_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_id  uuid NOT NULL REFERENCES public.outlet_daily_closings(id) ON DELETE CASCADE,
  -- Ridondanti ma indispensabili: la RLS filtra per azienda e outlet senza join.
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  outlet_id   uuid NOT NULL REFERENCES public.outlets(id),
  channel_id  uuid NOT NULL REFERENCES public.outlet_payment_channels(id),
  amount      numeric(14,2) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (closing_id, channel_id)
);

CREATE INDEX IF NOT EXISTS outlet_daily_closing_lines_closing
  ON public.outlet_daily_closing_lines (closing_id);

-- ---------------------------------------------------------------------
-- 4. Foto degli scontrini di chiusura
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outlet_daily_closing_attachments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_id         uuid NOT NULL REFERENCES public.outlet_daily_closings(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL REFERENCES public.companies(id),
  outlet_id          uuid NOT NULL REFERENCES public.outlets(id),
  kind               text NOT NULL DEFAULT 'altro'
                     CHECK (kind IN ('rt_chiusura', 'rt_rapporto_finanziario', 'rt_trasmissione', 'pos_chiusura', 'altro')),
  -- Percorso nel bucket 'cash-closings': company_id/outlet_id/YYYY-MM-DD/uuid.jpg
  storage_path       text NOT NULL,
  mime_type          text,
  size_bytes         integer,
  uploaded_by        uuid,
  uploaded_at        timestamptz NOT NULL DEFAULT now(),
  -- Fase 1b: lettura automatica della foto (Claude vision).
  extraction_status  text NOT NULL DEFAULT 'in_attesa'
                     CHECK (extraction_status IN ('in_attesa', 'letta', 'da_rivedere', 'fallita')),
  extracted          jsonb,
  extraction_model   text,
  extracted_at       timestamptz,
  UNIQUE (storage_path)
);

CREATE INDEX IF NOT EXISTS outlet_daily_closing_attachments_closing
  ON public.outlet_daily_closing_attachments (closing_id);

-- ---------------------------------------------------------------------
-- 5. Trigger di calcolo: somma canali, differenze, fondo cassa atteso
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
  v_prev_float     numeric(14,2);
BEGIN
  IF NEW.is_closed_day THEN
    -- Giornata a zero: niente incassi, il fondo resta quello di ieri.
    NEW.total_receipts := 0;
    NEW.cash_expenses  := COALESCE(NEW.cash_expenses, 0);
    NEW.cash_deposit   := COALESCE(NEW.cash_deposit, 0);
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN ch.counts_in_total THEN l.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ch.kind = 'contanti' THEN l.amount ELSE 0 END), 0)
  INTO v_channels_total, v_cash_line
  FROM public.outlet_daily_closing_lines l
  JOIN public.outlet_payment_channels ch ON ch.id = l.channel_id
  WHERE l.closing_id = NEW.id;

  NEW.channels_total      := v_channels_total;
  NEW.receipts_difference := COALESCE(NEW.total_receipts, 0) - v_channels_total;

  -- Fondo di ieri = fondo contato dell'ultima chiusura confermata precedente.
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
    NEW.cash_float_expected := v_prev_float + v_cash_line
                               - COALESCE(NEW.cash_expenses, 0) - COALESCE(NEW.cash_deposit, 0);
    NEW.cash_difference := CASE WHEN NEW.cash_float_declared IS NULL THEN NULL
                                ELSE NEW.cash_float_declared - NEW.cash_float_expected END;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_closing_compute ON public.outlet_daily_closings;
CREATE TRIGGER trg_cash_closing_compute
  BEFORE INSERT OR UPDATE ON public.outlet_daily_closings
  FOR EACH ROW EXECUTE FUNCTION public.fn_cash_closing_compute();

-- Ogni modifica alle righe "tocca" la chiusura: il BEFORE UPDATE ricalcola.
CREATE OR REPLACE FUNCTION public.fn_cash_closing_lines_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.outlet_daily_closings
     SET updated_at = now()
   WHERE id = COALESCE(NEW.closing_id, OLD.closing_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_closing_lines_touch ON public.outlet_daily_closing_lines;
CREATE TRIGGER trg_cash_closing_lines_touch
  AFTER INSERT OR UPDATE OR DELETE ON public.outlet_daily_closing_lines
  FOR EACH ROW EXECUTE FUNCTION public.fn_cash_closing_lines_touch();

-- ---------------------------------------------------------------------
-- 6. Proiezione in daily_revenue (le pagine esistenti la leggono gia')
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_cash_closing_to_daily_revenue(p_closing_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c        public.outlet_daily_closings%ROWTYPE;
  v_cash   numeric(14,2) := 0;
  v_card   numeric(14,2) := 0;
  v_other  numeric(14,2) := 0;
  v_vat    numeric := 22;
BEGIN
  SELECT * INTO c FROM public.outlet_daily_closings WHERE id = p_closing_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT
    COALESCE(SUM(CASE WHEN ch.kind = 'contanti' THEN l.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ch.kind IN ('pos', 'pos_amex') THEN l.amount ELSE 0 END), 0)
  INTO v_cash, v_card
  FROM public.outlet_daily_closing_lines l
  JOIN public.outlet_payment_channels ch ON ch.id = l.channel_id
  WHERE l.closing_id = c.id;

  v_other := GREATEST(c.total_receipts - v_cash - v_card, 0);

  -- Aliquota per lo scorporo IVA: impostazione per azienda, default 22%.
  v_vat := COALESCE((SELECT NULLIF(settings->>'cash_closing_vat_rate', '')::numeric
                     FROM public.companies WHERE id = c.company_id), 22);

  INSERT INTO public.daily_revenue AS dr
    (company_id, outlet_id, date, gross_revenue, net_revenue, transactions_count,
     avg_ticket, cash_amount, card_amount, other_amount, source, notes)
  VALUES
    (c.company_id, c.outlet_id, c.closing_date, c.total_receipts,
     ROUND(c.total_receipts / (1 + v_vat / 100), 2), 0, 0,
     v_cash, v_card, v_other, 'manuale'::import_source,
     'Chiusura cassa ' || c.id::text)
  ON CONFLICT (company_id, outlet_id, date) DO UPDATE SET
    gross_revenue = EXCLUDED.gross_revenue,
    net_revenue   = EXCLUDED.net_revenue,
    cash_amount   = EXCLUDED.cash_amount,
    card_amount   = EXCLUDED.card_amount,
    other_amount  = EXCLUDED.other_amount,
    source        = EXCLUDED.source,
    notes         = EXCLUDED.notes;
END;
$$;

REVOKE ALL ON FUNCTION public.project_cash_closing_to_daily_revenue(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_cash_closing_to_daily_revenue(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- 7. Conferma (foto obbligatorie), riapertura, richiesta di riapertura
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_cash_closing(p_closing_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c         public.outlet_daily_closings%ROWTYPE;
  v_photos  integer;
  v_note    text;
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
    SELECT count(*) INTO v_photos FROM public.outlet_daily_closing_attachments WHERE closing_id = c.id;
    IF v_photos = 0 THEN
      RAISE EXCEPTION 'Foto obbligatorie: allega almeno la chiusura del registratore e la chiusura POS' USING ERRCODE = 'P0001';
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
     SET status = 'confermata',
         notes = v_note,
         confirmed_at = now(),
         confirmed_by = auth.uid()
   WHERE id = c.id;

  -- Il fondo di stasera diventa il fondo di ieri per i giorni successivi
  -- ancora in bozza: si ricalcolano toccandoli.
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

REVOKE ALL ON FUNCTION public.confirm_cash_closing(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_cash_closing(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reopen_cash_closing(p_closing_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.outlet_daily_closings%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.outlet_daily_closings WHERE id = p_closing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chiusura non trovata' USING ERRCODE = 'P0002'; END IF;
  IF c.company_id <> public.get_my_company_id()
     OR public.get_my_role()::text NOT IN ('super_advisor', 'contabile') THEN
    RAISE EXCEPTION 'Solo super_advisor o contabile possono riaprire una chiusura' USING ERRCODE = '42501';
  END IF;
  IF c.status = 'bozza' THEN RETURN; END IF;

  -- La proiezione in daily_revenue resta: viene riscritta alla prossima conferma.
  UPDATE public.outlet_daily_closings
     SET status = 'bozza',
         reopened_at = now(),
         reopened_by = auth.uid(),
         reopen_reason = NULLIF(btrim(COALESCE(p_reason, '')), '')
   WHERE id = c.id;
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_cash_closing(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_cash_closing(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.request_cash_closing_reopen(p_closing_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c        public.outlet_daily_closings%ROWTYPE;
  v_outlet text;
BEGIN
  SELECT * INTO c FROM public.outlet_daily_closings WHERE id = p_closing_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chiusura non trovata' USING ERRCODE = 'P0002'; END IF;
  IF c.company_id <> public.get_my_company_id() OR NOT public.can_write_cash_closing(c.outlet_id) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  SELECT name INTO v_outlet FROM public.outlets WHERE id = c.outlet_id;

  INSERT INTO public.notifications
    (company_id, user_id, title, message, category, severity, action_url, action_label, reference_type, reference_id)
  VALUES
    (c.company_id, NULL,
     'Richiesta riapertura chiusura cassa: ' || COALESCE(v_outlet, '') || ' ' || to_char(c.closing_date, 'DD/MM/YYYY'),
     'Il negozio chiede di riaprire la chiusura del ' || to_char(c.closing_date, 'DD/MM/YYYY')
       || COALESCE('. Motivo: ' || NULLIF(btrim(p_reason), ''), '') || '. Apri Incassi giornalieri per riaprirla.',
     'info', 'warning',
     '/incassi-giornalieri?outlet=' || c.outlet_id::text || '&date=' || to_char(c.closing_date, 'YYYY-MM-DD'),
     'Vai agli incassi giornalieri', 'cash_closing', c.id);
END;
$$;

REVOKE ALL ON FUNCTION public.request_cash_closing_reopen(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_cash_closing_reopen(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------
ALTER TABLE public.outlet_payment_channels         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlet_daily_closings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlet_daily_closing_lines      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlet_daily_closing_attachments ENABLE ROW LEVEL SECURITY;

-- Canali: tutti quelli con accesso all'outlet leggono; scrivono super_advisor e contabile.
CREATE POLICY opc_select ON public.outlet_payment_channels
  FOR SELECT USING (company_id = public.get_my_company_id() AND public.has_outlet_access(outlet_id));
CREATE POLICY opc_write ON public.outlet_payment_channels
  FOR ALL USING (company_id = public.get_my_company_id()
                 AND public.get_my_role()::text IN ('super_advisor', 'contabile'))
  WITH CHECK (company_id = public.get_my_company_id()
              AND public.get_my_role()::text IN ('super_advisor', 'contabile'));

-- Chiusure: si inseriscono e modificano SOLO in bozza; le transizioni di
-- stato passano dalle funzioni. Nessuna DELETE (NO DATA LOSS).
CREATE POLICY odc_select ON public.outlet_daily_closings
  FOR SELECT USING (company_id = public.get_my_company_id() AND public.has_outlet_access(outlet_id));
CREATE POLICY odc_insert ON public.outlet_daily_closings
  FOR INSERT WITH CHECK (company_id = public.get_my_company_id()
                         AND public.can_write_cash_closing(outlet_id)
                         AND status = 'bozza');
CREATE POLICY odc_update ON public.outlet_daily_closings
  FOR UPDATE USING (company_id = public.get_my_company_id()
                    AND public.can_write_cash_closing(outlet_id)
                    AND status = 'bozza')
  WITH CHECK (company_id = public.get_my_company_id()
              AND public.can_write_cash_closing(outlet_id)
              AND status = 'bozza');

-- Righe: seguono la chiusura (solo in bozza).
CREATE POLICY odcl_select ON public.outlet_daily_closing_lines
  FOR SELECT USING (company_id = public.get_my_company_id() AND public.has_outlet_access(outlet_id));
CREATE POLICY odcl_write ON public.outlet_daily_closing_lines
  FOR ALL USING (company_id = public.get_my_company_id()
                 AND public.can_write_cash_closing(outlet_id)
                 AND EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                             WHERE c.id = closing_id AND c.status = 'bozza'))
  WITH CHECK (company_id = public.get_my_company_id()
              AND public.can_write_cash_closing(outlet_id)
              AND EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                          WHERE c.id = closing_id AND c.status = 'bozza'));

-- Foto: si caricano in bozza; si puo' togliere solo la propria foto finche'
-- la chiusura e' in bozza (una foto sfocata prima della conferma non e' un
-- dato). Dopo la conferma nessuna cancellazione. L'UPDATE (esito lettura
-- automatica, fase 1b) e' riservato a super_advisor/contabile e service_role.
CREATE POLICY odca_select ON public.outlet_daily_closing_attachments
  FOR SELECT USING (company_id = public.get_my_company_id() AND public.has_outlet_access(outlet_id));
CREATE POLICY odca_insert ON public.outlet_daily_closing_attachments
  FOR INSERT WITH CHECK (company_id = public.get_my_company_id()
                         AND public.can_write_cash_closing(outlet_id)
                         AND uploaded_by = auth.uid()
                         AND EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                                     WHERE c.id = closing_id AND c.status = 'bozza'));
CREATE POLICY odca_delete ON public.outlet_daily_closing_attachments
  FOR DELETE USING (company_id = public.get_my_company_id()
                    AND uploaded_by = auth.uid()
                    AND EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                                WHERE c.id = closing_id AND c.status = 'bozza'));
CREATE POLICY odca_update ON public.outlet_daily_closing_attachments
  FOR UPDATE USING (company_id = public.get_my_company_id()
                    AND public.get_my_role()::text IN ('super_advisor', 'contabile'))
  WITH CHECK (company_id = public.get_my_company_id());

REVOKE ALL ON public.outlet_payment_channels, public.outlet_daily_closings,
              public.outlet_daily_closing_lines, public.outlet_daily_closing_attachments
  FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.outlet_payment_channels TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.outlet_daily_closings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlet_daily_closing_lines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlet_daily_closing_attachments TO authenticated;
GRANT ALL ON public.outlet_payment_channels, public.outlet_daily_closings,
             public.outlet_daily_closing_lines, public.outlet_daily_closing_attachments
  TO service_role;

-- ---------------------------------------------------------------------
-- 9. Bucket privato 'cash-closings' per le foto
--    Percorso: company_id/outlet_id/YYYY-MM-DD/uuid.jpg
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cash-closings', 'cash-closings', false, 10485760,
        ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']::text[])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Outlet ricavato dal percorso, solo se il primo segmento e' la MIA azienda.
CREATE OR REPLACE FUNCTION public.cash_closing_storage_outlet(p_name text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
     AND split_part(p_name, '/', 1)::uuid = public.get_my_company_id()
    THEN split_part(p_name, '/', 2)::uuid
    ELSE NULL END;
$$;

REVOKE ALL ON FUNCTION public.cash_closing_storage_outlet(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_closing_storage_outlet(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "cash_closings_read" ON storage.objects;
CREATE POLICY "cash_closings_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'cash-closings'
         AND public.cash_closing_storage_outlet(name) IS NOT NULL
         AND public.has_outlet_access(public.cash_closing_storage_outlet(name)));

DROP POLICY IF EXISTS "cash_closings_insert" ON storage.objects;
CREATE POLICY "cash_closings_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cash-closings'
              AND public.cash_closing_storage_outlet(name) IS NOT NULL
              AND public.can_write_cash_closing(public.cash_closing_storage_outlet(name)));

-- Cancellazione: solo il proprietario del file (foto sbagliata prima della
-- conferma) o un super_advisor. Nessun UPDATE: una foto non si sovrascrive.
DROP POLICY IF EXISTS "cash_closings_delete" ON storage.objects;
CREATE POLICY "cash_closings_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'cash-closings'
         AND (COALESCE(owner_id, owner::text) = auth.uid()::text
              OR public.get_my_role()::text = 'super_advisor'));

COMMIT;

-- =====================================================================
-- VERIFICA (dopo l'applicazione su ciascun tenant):
--   SELECT count(*) FROM pg_tables WHERE schemaname='public'
--     AND tablename IN ('outlet_payment_channels','outlet_daily_closings',
--                       'outlet_daily_closing_lines','outlet_daily_closing_attachments');  -- 4
--   SELECT count(*) FROM pg_policies WHERE tablename LIKE 'outlet_daily_closing%'
--     OR tablename = 'outlet_payment_channels';                                              -- 11
--   SELECT id, public FROM storage.buckets WHERE id = 'cash-closings';                       -- false
--   SELECT proname FROM pg_proc WHERE proname IN ('confirm_cash_closing','reopen_cash_closing',
--     'request_cash_closing_reopen','can_write_cash_closing','project_cash_closing_to_daily_revenue');
-- =====================================================================
