-- =====================================================================
-- 188 — Verifica delle chiusure di cassa con la banca (fase 3 specchietto)
--
-- Cosa fa:
--   1. Sulle righe canale (POS, Amex) e sul versamento della chiusura compare
--      l'esito banca: in_attesa / accreditato / differenza / mancante /
--      non_verificabile, con l'importo accreditato e la data del riscontro.
--   2. closing_bank_matches: ogni movimento bancario abbinato a una riga o al
--      versamento di una chiusura (mai piu' di una volta).
--   3. Parser delle causali (funzioni IMMUTABLE): codice terminale e data di
--      riferimento dagli accrediti POS (CBI "COD.SIA:xxxxxxx-nnnnn ... DATA
--      RIF.: gg.mm.aa") e Amex ("Accredito per incassi gg.mm.aaaa <nome>
--      xxxxxxxnnnnn American Express"); riconoscimento dei versamenti.
--   4. match_cash_closings_with_bank(): per (terminale, data riferimento)
--      somma gli accrediti e li confronta con la riga della chiusura di quel
--      giorno; cerca il versamento dichiarato tra i versamenti in banca
--      (importo esatto, 0-6 giorni, parola chiave o conto dell'outlet);
--      passa la chiusura a 'verificata' quando tutto torna. Gira ogni mattina
--      (cron cash-bank-matching-daily, dopo la riconciliazione) e a richiesta.
--   5. list_bank_terminal_codes(): i codici terminale visti in banca, per
--      mappare i canali. cash_bank_monthly_summary(): controlli del mese.
--
-- Il canale Contanti usa terminal_code come "parola chiave versamento"
-- (es. PALMANOVA, FOIANO, 2121, 2751|3246): cercata nella causale del
-- versamento. Nessun valore di tenant nel codice.
-- Additiva: nessun DROP. Da applicare su NZ → Made → Zago.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 1. Esito banca su righe e chiusura
-- ---------------------------------------------------------------------
ALTER TABLE public.outlet_daily_closing_lines
  ADD COLUMN IF NOT EXISTS bank_status text NOT NULL DEFAULT 'in_attesa',
  ADD COLUMN IF NOT EXISTS bank_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS bank_matched_at timestamptz;
ALTER TABLE public.outlet_daily_closing_lines
  DROP CONSTRAINT IF EXISTS outlet_daily_closing_lines_bank_status_check;
ALTER TABLE public.outlet_daily_closing_lines
  ADD CONSTRAINT outlet_daily_closing_lines_bank_status_check
  CHECK (bank_status IN ('in_attesa', 'accreditato', 'differenza', 'mancante', 'non_verificabile'));

ALTER TABLE public.outlet_daily_closings
  ADD COLUMN IF NOT EXISTS deposit_bank_status text NOT NULL DEFAULT 'in_attesa',
  ADD COLUMN IF NOT EXISTS deposit_bank_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS deposit_bank_transaction_id uuid,
  ADD COLUMN IF NOT EXISTS bank_verified_at timestamptz;
ALTER TABLE public.outlet_daily_closings
  DROP CONSTRAINT IF EXISTS outlet_daily_closings_deposit_bank_status_check;
ALTER TABLE public.outlet_daily_closings
  ADD CONSTRAINT outlet_daily_closings_deposit_bank_status_check
  CHECK (deposit_bank_status IN ('in_attesa', 'accreditato', 'differenza', 'mancante', 'non_verificabile'));

-- ---------------------------------------------------------------------
-- 2. Abbinamenti chiusura ↔ movimento bancario
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.closing_bank_matches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id),
  closing_id          uuid NOT NULL REFERENCES public.outlet_daily_closings(id) ON DELETE CASCADE,
  line_id             uuid REFERENCES public.outlet_daily_closing_lines(id) ON DELETE CASCADE,
  bank_transaction_id uuid NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  amount              numeric(14,2) NOT NULL,
  match_type          text NOT NULL CHECK (match_type IN ('pos', 'amex', 'versamento')),
  reference_date      date,
  matched_at          timestamptz NOT NULL DEFAULT now(),
  note                text,
  UNIQUE (bank_transaction_id)
);
CREATE INDEX IF NOT EXISTS closing_bank_matches_closing ON public.closing_bank_matches (closing_id);
CREATE INDEX IF NOT EXISTS closing_bank_matches_line ON public.closing_bank_matches (line_id);

ALTER TABLE public.closing_bank_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cbm_select ON public.closing_bank_matches;
CREATE POLICY cbm_select ON public.closing_bank_matches
  FOR SELECT USING (company_id = public.get_my_company_id());
DROP POLICY IF EXISTS cash_operator_block ON public.closing_bank_matches;
CREATE POLICY cash_operator_block ON public.closing_bank_matches AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (COALESCE(public.get_my_role()::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE(public.get_my_role()::text, '') <> 'operatore_cassa');

-- ---------------------------------------------------------------------
-- 3. Parser delle causali
-- ---------------------------------------------------------------------
-- Ultime 5 cifre del codice terminale: MPS "COD.SIA:6181087-00002",
-- Amex "618108700006 American Express". NULL se non e' un accredito POS.
CREATE OR REPLACE FUNCTION public.cash_bank_terminal_code(p_descr text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    (regexp_match(COALESCE(p_descr, ''), 'COD\.?\s*SIA\s*:?\s*\d{5,}\s*-\s*(\d{5})', 'i'))[1],
    (regexp_match(COALESCE(p_descr, ''), '(\d{5})\s+American\s+Express', 'i'))[1]
  );
$$;

-- Circuito dell'accredito: 'amex' o 'pos' (NULL se non riconosciuto).
CREATE OR REPLACE FUNCTION public.cash_bank_circuit(p_descr text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(p_descr, '') ~* 'American\s+Express' THEN 'amex'
    WHEN COALESCE(p_descr, '') ~* 'COD\.?\s*SIA' THEN 'pos'
    ELSE NULL END;
$$;

-- Giorno di vendita a cui l'accredito si riferisce: "DATA RIF.: 03.09.26"
-- (MPS) o "incassi 02.09.2026" (Amex). Senza data in causale: NULL.
CREATE OR REPLACE FUNCTION public.cash_bank_ref_date(p_descr text)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m text[];
BEGIN
  m := regexp_match(COALESCE(p_descr, ''), 'DATA\s*RIF\.?\s*:?\s*(\d{2})\.(\d{2})\.(\d{2,4})', 'i');
  IF m IS NOT NULL THEN
    RETURN make_date(CASE WHEN length(m[3]) = 2 THEN 2000 + m[3]::int ELSE m[3]::int END, m[2]::int, m[1]::int);
  END IF;
  m := regexp_match(COALESCE(p_descr, ''), 'incassi\s+(\d{2})\.(\d{2})\.(\d{4})', 'i');
  IF m IS NOT NULL THEN
    RETURN make_date(m[3]::int, m[2]::int, m[1]::int);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Versamento di contante (ATM, cassa continua, sportello).
CREATE OR REPLACE FUNCTION public.cash_bank_is_deposit(p_descr text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_descr, '') ~* '(VERSAMENTO|VERS\.|CASSA\s+CONTIN|\yATM\y|VERS\.?\s*SPORT)'
     AND COALESCE(p_descr, '') !~* '(BONIFICO|GIROCONTO|GIROC\.|STORNO)';
$$;

-- Normalizza il codice scritto nel canale ("6181087-00002", "00002", "2") → "00002".
CREATE OR REPLACE FUNCTION public.cash_bank_norm_code(p_code text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN NULLIF(regexp_replace(COALESCE(p_code, ''), '\D', '', 'g'), '') IS NULL THEN NULL
              ELSE lpad(right(regexp_replace(p_code, '\D', '', 'g'), 5), 5, '0') END;
$$;

-- ---------------------------------------------------------------------
-- 4. Il riscontro
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_cash_closings_with_bank(
  p_company_id uuid DEFAULT NULL,
  p_days       integer DEFAULT 60,
  p_tolerance  numeric DEFAULT 0.01
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from      date := current_date - GREATEST(p_days, 1);
  v_pos       integer := 0;
  v_dep       integer := 0;
  v_verified  integer := 0;
  r           record;
  v_line      record;
  v_kw        text;
  v_tx        record;
  v_n         integer;
BEGIN
  -- A. Accrediti POS/Amex non ancora abbinati, sommati per (azienda, terminale, giorno di riferimento)
  FOR r IN
    SELECT bt.company_id,
           public.cash_bank_terminal_code(bt.description) AS code,
           public.cash_bank_circuit(bt.description)       AS circuit,
           public.cash_bank_ref_date(bt.description)      AS ref_date,
           round(sum(bt.amount), 2)                       AS total,
           array_agg(bt.id)                               AS ids
      FROM public.bank_transactions bt
     WHERE bt.amount > 0
       AND bt.transaction_date >= v_from
       AND COALESCE(bt.status, 'booked') IN ('posted', 'booked')
       AND (p_company_id IS NULL OR bt.company_id = p_company_id)
       AND public.cash_bank_terminal_code(bt.description) IS NOT NULL
       AND public.cash_bank_ref_date(bt.description) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
     GROUP BY 1, 2, 3, 4
  LOOP
    -- La riga della chiusura CONFERMATA di quel giorno, sul canale con quel terminale
    SELECT l.id, l.closing_id, l.amount, c.status AS closing_status
      INTO v_line
      FROM public.outlet_payment_channels ch
      JOIN public.outlet_daily_closings c ON c.outlet_id = ch.outlet_id AND c.closing_date = r.ref_date
      JOIN public.outlet_daily_closing_lines l ON l.closing_id = c.id AND l.channel_id = ch.id
     WHERE ch.company_id = r.company_id
       AND ch.is_active
       AND public.cash_bank_norm_code(ch.terminal_code) = r.code
       AND ch.kind = CASE WHEN r.circuit = 'amex' THEN 'pos_amex' ELSE 'pos' END
       AND c.status IN ('confermata', 'verificata')
     LIMIT 1;
    IF NOT FOUND THEN CONTINUE; END IF;  -- chiusura non ancora confermata o canale non mappato: si riprova domani

    INSERT INTO public.closing_bank_matches (company_id, closing_id, line_id, bank_transaction_id, amount, match_type, reference_date)
    SELECT r.company_id, v_line.closing_id, v_line.id, bt.id, bt.amount, CASE WHEN r.circuit = 'amex' THEN 'amex' ELSE 'pos' END, r.ref_date
      FROM public.bank_transactions bt WHERE bt.id = ANY (r.ids)
    ON CONFLICT (bank_transaction_id) DO NOTHING;

    UPDATE public.bank_transactions
       SET is_reconciled = true, reconciled_at = COALESCE(reconciled_at, now()), category = COALESCE(category, 'incassi_pos'),
           note = CASE WHEN COALESCE(note, '') LIKE '%chiusura cassa%' THEN note
                       ELSE COALESCE(note || ' | ', '') || 'abbinato a chiusura cassa del ' || to_char(r.ref_date, 'DD/MM/YYYY') END
     WHERE id = ANY (r.ids);
    v_pos := v_pos + 1;
  END LOOP;

  -- A2. Ricalcolo esito di tutte le righe POS/Amex con abbinamenti (anche se l'importo e' stato corretto dopo)
  UPDATE public.outlet_daily_closing_lines l
     SET bank_amount = s.tot,
         bank_status = CASE WHEN abs(s.tot - l.amount) <= p_tolerance THEN 'accreditato' ELSE 'differenza' END,
         bank_matched_at = s.last_at
    FROM (SELECT line_id, round(sum(amount), 2) AS tot, max(matched_at) AS last_at
            FROM public.closing_bank_matches WHERE line_id IS NOT NULL GROUP BY line_id) s
   WHERE l.id = s.line_id
     AND (p_company_id IS NULL OR l.company_id = p_company_id)
     AND (l.bank_amount IS DISTINCT FROM s.tot
          OR l.bank_status <> CASE WHEN abs(s.tot - l.amount) <= p_tolerance THEN 'accreditato' ELSE 'differenza' END);

  -- A3. Righe POS/Amex con importo, chiusura confermata, senza accredito dopo 5 giorni → mancante;
  --     canale senza codice terminale → non verificabile.
  UPDATE public.outlet_daily_closing_lines l
     SET bank_status = CASE WHEN public.cash_bank_norm_code(ch.terminal_code) IS NULL THEN 'non_verificabile' ELSE 'mancante' END
    FROM public.outlet_daily_closings c, public.outlet_payment_channels ch
   WHERE c.id = l.closing_id AND ch.id = l.channel_id
     AND (p_company_id IS NULL OR l.company_id = p_company_id)
     AND ch.kind IN ('pos', 'pos_amex') AND l.amount > 0
     AND l.bank_status = 'in_attesa'
     AND c.status IN ('confermata', 'verificata')
     AND c.closing_date >= v_from
     AND (public.cash_bank_norm_code(ch.terminal_code) IS NULL OR c.closing_date <= current_date - 5);

  -- B. Versamenti dichiarati: importo esatto, entro 6 giorni, parola chiave o conto del canale Contanti
  FOR r IN
    SELECT c.id AS closing_id, c.company_id, c.outlet_id, c.closing_date, c.cash_deposit,
           ch.terminal_code AS deposit_kw, ch.bank_account_id
      FROM public.outlet_daily_closings c
      LEFT JOIN public.outlet_payment_channels ch ON ch.outlet_id = c.outlet_id AND ch.kind = 'contanti' AND ch.is_active
     WHERE c.cash_deposit > 0
       AND c.deposit_bank_status IN ('in_attesa', 'mancante')
       AND c.status IN ('confermata', 'verificata')
       AND c.closing_date >= v_from
       AND (p_company_id IS NULL OR c.company_id = p_company_id)
     ORDER BY c.closing_date
  LOOP
    v_kw := NULLIF(btrim(COALESCE(r.deposit_kw, '')), '');
    SELECT bt.id, bt.amount, bt.transaction_date INTO v_tx
      FROM public.bank_transactions bt
     WHERE bt.company_id = r.company_id
       AND bt.amount = r.cash_deposit
       AND bt.transaction_date BETWEEN r.closing_date AND r.closing_date + 6
       AND COALESCE(bt.status, 'booked') IN ('posted', 'booked')
       AND public.cash_bank_is_deposit(bt.description)
       AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
       AND (v_kw IS NULL OR bt.description ~* ('(' || v_kw || ')'))
       AND (v_kw IS NOT NULL OR r.bank_account_id IS NULL OR bt.bank_account_id = r.bank_account_id)
     ORDER BY bt.transaction_date, bt.id
     LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.closing_bank_matches (company_id, closing_id, line_id, bank_transaction_id, amount, match_type, reference_date)
      VALUES (r.company_id, r.closing_id, NULL, v_tx.id, v_tx.amount, 'versamento', r.closing_date)
      ON CONFLICT (bank_transaction_id) DO NOTHING;
      UPDATE public.outlet_daily_closings
         SET deposit_bank_status = 'accreditato', deposit_bank_amount = v_tx.amount, deposit_bank_transaction_id = v_tx.id
       WHERE id = r.closing_id;
      UPDATE public.bank_transactions
         SET is_reconciled = true, reconciled_at = COALESCE(reconciled_at, now()), category = COALESCE(category, 'versamenti'),
             note = COALESCE(note || ' | ', '') || 'versamento della chiusura cassa del ' || to_char(r.closing_date, 'DD/MM/YYYY')
       WHERE id = v_tx.id;
      v_dep := v_dep + 1;
    ELSIF r.closing_date <= current_date - 7 THEN
      UPDATE public.outlet_daily_closings SET deposit_bank_status = 'mancante' WHERE id = r.closing_id AND deposit_bank_status = 'in_attesa';
    END IF;
  END LOOP;

  -- C. Chiusura verificata: tutte le righe POS/Amex con importo accreditate e versamento (se c'e') trovato
  UPDATE public.outlet_daily_closings c
     SET status = 'verificata', bank_verified_at = now()
   WHERE c.status = 'confermata'
     AND c.closing_date >= v_from
     AND (p_company_id IS NULL OR c.company_id = p_company_id)
     AND (c.cash_deposit = 0 OR c.deposit_bank_status = 'accreditato')
     AND EXISTS (SELECT 1 FROM public.outlet_daily_closing_lines l JOIN public.outlet_payment_channels ch ON ch.id = l.channel_id
                  WHERE l.closing_id = c.id AND ch.kind IN ('pos', 'pos_amex') AND l.amount > 0)
     AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_lines l JOIN public.outlet_payment_channels ch ON ch.id = l.channel_id
                      WHERE l.closing_id = c.id AND ch.kind IN ('pos', 'pos_amex') AND l.amount > 0 AND l.bank_status <> 'accreditato');
  GET DIAGNOSTICS v_verified = ROW_COUNT;

  RETURN jsonb_build_object('gruppi_pos_abbinati', v_pos, 'versamenti_abbinati', v_dep, 'chiusure_verificate', v_verified, 'run_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.match_cash_closings_with_bank(uuid, integer, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_cash_closings_with_bank(uuid, integer, numeric) TO service_role;

-- A richiesta dalla UI (super_advisor / contabile), solo sulla propria azienda.
CREATE OR REPLACE FUNCTION public.run_cash_bank_matching(p_days integer DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(public.get_my_role()::text, '') NOT IN ('super_advisor', 'contabile') THEN
    RAISE EXCEPTION 'Solo super advisor e contabile possono lanciare il riscontro con la banca' USING ERRCODE = '42501';
  END IF;
  RETURN public.match_cash_closings_with_bank(public.get_my_company_id(), LEAST(GREATEST(p_days, 1), 120), 0.01);
END;
$$;
REVOKE ALL ON FUNCTION public.run_cash_bank_matching(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_cash_bank_matching(integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Codici terminale visti in banca (per mappare i canali) e controlli del mese
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_bank_terminal_codes(p_days integer DEFAULT 90)
RETURNS TABLE (code text, circuit text, bank_account_id uuid, n bigint, total numeric, first_date date, last_date date, sample text, mapped_channel_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH tx AS (
    SELECT public.cash_bank_terminal_code(bt.description) AS code,
           public.cash_bank_circuit(bt.description) AS circuit,
           bt.bank_account_id, bt.amount, bt.transaction_date, bt.description
      FROM public.bank_transactions bt
     WHERE bt.company_id = public.get_my_company_id()
       AND bt.amount > 0
       AND bt.transaction_date >= current_date - GREATEST(p_days, 1)
       AND public.cash_bank_terminal_code(bt.description) IS NOT NULL
  )
  SELECT t.code, t.circuit, t.bank_account_id, count(*) AS n, round(sum(t.amount), 2) AS total,
         min(t.transaction_date), max(t.transaction_date),
         left(regexp_replace(max(t.description), 'Causale:.*Descrizione:\s*', ''), 90) AS sample,
         (SELECT ch.id FROM public.outlet_payment_channels ch
           WHERE ch.company_id = public.get_my_company_id() AND ch.is_active
             AND public.cash_bank_norm_code(ch.terminal_code) = t.code
             AND ch.kind = CASE WHEN t.circuit = 'amex' THEN 'pos_amex' ELSE 'pos' END
           LIMIT 1) AS mapped_channel_id
    FROM tx t
   WHERE COALESCE(public.get_my_role()::text, '') IN ('super_advisor', 'contabile')
   GROUP BY t.code, t.circuit, t.bank_account_id
   ORDER BY t.circuit, t.code;
$$;
REVOKE ALL ON FUNCTION public.list_bank_terminal_codes(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_bank_terminal_codes(integer) TO authenticated, service_role;

-- Controlli del mese: per canale POS/Amex (dichiarato vs accreditato), per outlet
-- (contanti incassati, versamenti dichiarati e trovati, fondo cassa), accrediti
-- non abbinati del mese (terminali senza canale o giorni senza chiusura).
CREATE OR REPLACE FUNCTION public.cash_bank_monthly_summary(p_year integer, p_month integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_from date := make_date(p_year, p_month, 1);
  v_to   date := (make_date(p_year, p_month, 1) + interval '1 month')::date;
  v_channels jsonb; v_outlets jsonb; v_unmatched jsonb;
BEGIN
  IF COALESCE(public.get_my_role()::text, '') NOT IN ('super_advisor', 'contabile') THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'outlet_name', x->>'label'), '[]'::jsonb) INTO v_channels
  FROM (
    SELECT jsonb_build_object(
      'channel_id', ch.id, 'label', ch.label, 'kind', ch.kind, 'terminal_code', ch.terminal_code,
      'outlet_id', ch.outlet_id, 'outlet_name', o.name,
      'declared', COALESCE(sum(l.amount), 0),
      'credited', COALESCE(sum(l.bank_amount), 0),
      'days', count(l.id) FILTER (WHERE l.amount > 0),
      'accreditato', count(l.id) FILTER (WHERE l.amount > 0 AND l.bank_status = 'accreditato'),
      'differenza', count(l.id) FILTER (WHERE l.amount > 0 AND l.bank_status = 'differenza'),
      'mancante', count(l.id) FILTER (WHERE l.amount > 0 AND l.bank_status = 'mancante'),
      'in_attesa', count(l.id) FILTER (WHERE l.amount > 0 AND l.bank_status = 'in_attesa'),
      'non_verificabile', count(l.id) FILTER (WHERE l.amount > 0 AND l.bank_status = 'non_verificabile')
    ) AS x
    FROM public.outlet_payment_channels ch
    JOIN public.outlets o ON o.id = ch.outlet_id
    LEFT JOIN public.outlet_daily_closing_lines l ON l.channel_id = ch.id
    LEFT JOIN public.outlet_daily_closings c ON c.id = l.closing_id AND c.closing_date >= v_from AND c.closing_date < v_to AND c.status IN ('confermata', 'verificata')
    WHERE ch.company_id = v_company AND ch.is_active AND ch.kind IN ('pos', 'pos_amex')
      AND (l.id IS NULL OR c.id IS NOT NULL)
    GROUP BY ch.id, ch.label, ch.kind, ch.terminal_code, ch.outlet_id, o.name
  ) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'outlet_name'), '[]'::jsonb) INTO v_outlets
  FROM (
    SELECT jsonb_build_object(
      'outlet_id', o.id, 'outlet_name', o.name,
      'closings', count(c.id),
      'verified', count(c.id) FILTER (WHERE c.status = 'verificata'),
      'cash_in', COALESCE((SELECT sum(l.amount) FROM public.outlet_daily_closing_lines l JOIN public.outlet_payment_channels ch ON ch.id = l.channel_id
                             WHERE l.closing_id IN (SELECT id FROM public.outlet_daily_closings cc WHERE cc.outlet_id = o.id AND cc.closing_date >= v_from AND cc.closing_date < v_to AND cc.status IN ('confermata','verificata'))
                               AND ch.kind = 'contanti'), 0),
      'expenses', COALESCE(sum(c.cash_expenses + c.customer_refunds), 0),
      'deposits_declared', COALESCE(sum(c.cash_deposit), 0),
      'deposits_found', COALESCE(sum(c.deposit_bank_amount) FILTER (WHERE c.deposit_bank_status = 'accreditato'), 0),
      'deposits_missing', count(c.id) FILTER (WHERE c.cash_deposit > 0 AND c.deposit_bank_status = 'mancante'),
      'deposits_pending', count(c.id) FILTER (WHERE c.cash_deposit > 0 AND c.deposit_bank_status = 'in_attesa'),
      'float_start', (SELECT COALESCE(cc.cash_float_expected - (SELECT sum(l2.amount) FROM public.outlet_daily_closing_lines l2 JOIN public.outlet_payment_channels ch2 ON ch2.id = l2.channel_id WHERE l2.closing_id = cc.id AND ch2.kind = 'contanti') + cc.cash_expenses + cc.customer_refunds + cc.cash_deposit, cc.cash_float_opening)
                        FROM public.outlet_daily_closings cc WHERE cc.outlet_id = o.id AND cc.closing_date >= v_from AND cc.closing_date < v_to AND cc.status IN ('confermata','verificata') ORDER BY cc.closing_date LIMIT 1),
      'float_end', (SELECT cc.cash_float_declared FROM public.outlet_daily_closings cc WHERE cc.outlet_id = o.id AND cc.closing_date >= v_from AND cc.closing_date < v_to AND cc.status IN ('confermata','verificata') ORDER BY cc.closing_date DESC LIMIT 1)
    ) AS x
    FROM public.outlets o
    LEFT JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date >= v_from AND c.closing_date < v_to AND c.status IN ('confermata', 'verificata')
    WHERE o.company_id = v_company AND COALESCE(o.is_active, true)
      AND lower(COALESCE(o.outlet_type, 'outlet')) NOT IN ('sede', 'magazzino', 'warehouse', 'hq', 'ufficio')
    GROUP BY o.id, o.name
  ) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'circuit', x->>'code', x->>'ref_date'), '[]'::jsonb) INTO v_unmatched
  FROM (
    SELECT jsonb_build_object(
      'code', public.cash_bank_terminal_code(bt.description), 'circuit', public.cash_bank_circuit(bt.description),
      'ref_date', public.cash_bank_ref_date(bt.description), 'n', count(*), 'total', round(sum(bt.amount), 2),
      'mapped', EXISTS (SELECT 1 FROM public.outlet_payment_channels ch WHERE ch.company_id = v_company AND ch.is_active
                          AND public.cash_bank_norm_code(ch.terminal_code) = public.cash_bank_terminal_code(bt.description)
                          AND ch.kind = CASE WHEN public.cash_bank_circuit(bt.description) = 'amex' THEN 'pos_amex' ELSE 'pos' END)
    ) AS x
    FROM public.bank_transactions bt
    WHERE bt.company_id = v_company AND bt.amount > 0
      AND public.cash_bank_terminal_code(bt.description) IS NOT NULL
      AND public.cash_bank_ref_date(bt.description) >= v_from AND public.cash_bank_ref_date(bt.description) < v_to
      AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
    GROUP BY 1, 2, 3
  ) q;

  RETURN jsonb_build_object('year', p_year, 'month', p_month, 'channels', v_channels, 'outlets', v_outlets, 'unmatched', v_unmatched);
END;
$$;
REVOKE ALL ON FUNCTION public.cash_bank_monthly_summary(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_bank_monthly_summary(integer, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Schedulazione: ogni mattina alle 06:05 UTC, dopo la riconciliazione
--    notturna delle 05:45 (run_daily_reconciliation resta com'e': il suo corpo
--    differisce fra i tenant e non va sovrascritto). Nessun valore di tenant.
-- ---------------------------------------------------------------------
SELECT cron.unschedule('cash-bank-matching-daily')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cash-bank-matching-daily');
SELECT cron.schedule('cash-bank-matching-daily', '5 6 * * *', $$SELECT public.match_cash_closings_with_bank();$$);

COMMIT;
