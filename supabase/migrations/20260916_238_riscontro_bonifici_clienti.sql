-- =====================================================================
-- 238 — Riscontro cassa/banca: anche i bonifici dei clienti
-- ---------------------------------------------------------------------
-- Le chiusure di cassa hanno un canale «Bonifico»: il negozio ci scrive
-- quanto ha incassato con bonifico da un cliente (un abito pagato a
-- distanza, un ordine). In banca quel bonifico arriva come entrata da un
-- privato, di solito lo stesso giorno o nei giorni prima (il negozio
-- registra la vendita quando vede il bonifico), a volte in due bonifici
-- (Barberino 06/08/2026: 140,00 = 82,00 Scanu + 58,00 Becattini).
--
-- Il riscontro notturno (188 → 224) abbinava POS, Amex e versamenti, non i
-- bonifici: in Prima Nota → Incassi per outlet restavano «da attribuire»
-- e qualcuno li assegnava a mano con la nota «Outlet: BRB · …», che e'
-- proprio la lista da compilare a mano che il gestionale non deve chiedere.
-- Sui dati NZ 2026: 18 righe «Bonifico» nelle chiusure, 15 hanno il loro
-- bonifico in banca fra 6 giorni prima e 1 giorno dopo la chiusura; le altre
-- 3 (24/02 322,00; 08/07 158,00; 31/08 25,90) non hanno nessun bonifico in
-- banca e restano «mancante».
--
-- Cosa cambia (additiva, idempotente, tutti i tenant):
--   * closing_bank_matches.match_type ammette 'bonifico';
--   * cash_bank_is_customer_transfer(descr): bonifico in entrata da un
--     privato (non stipendi, giroconti, note di credito, rimborsi, storni);
--   * match_customer_transfers_with_closings(company, da, tolleranza): per
--     ogni riga «Bonifico» non ancora riscontrata cerca prima il bonifico
--     con lo stesso importo (fra 10 giorni prima e 3 dopo, il piu' vicino),
--     poi la coppia che somma; scrive il match, marca il movimento
--     (categoria incassi_clienti, nota) e la riga (accreditato / mancante
--     dopo 10 giorni). Esclude i bonifici gia' agganciati a una fattura.
--   * match_cash_closings_with_bank la chiama in coda (sezione E) e
--     riporta 'bonifici_clienti_abbinati' nell'esito.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Il tipo di match
-- ---------------------------------------------------------------------
ALTER TABLE public.closing_bank_matches
  DROP CONSTRAINT IF EXISTS closing_bank_matches_match_type_check;
ALTER TABLE public.closing_bank_matches
  ADD CONSTRAINT closing_bank_matches_match_type_check
  CHECK (match_type IN ('pos', 'amex', 'versamento', 'bonifico'));

-- ---------------------------------------------------------------------
-- 2. Bonifico in entrata da un cliente
-- ---------------------------------------------------------------------
-- MPS scrive «ACC.X GIROC.FRA NOMIN.DIV» quando il cliente ha il conto nella
-- stessa banca (Barberino 18/06/2026: 43,80 «T-SHIRT PIZZO»): e' un bonifico
-- di cliente, non un giroconto nostro. Quel prefisso si toglie prima di
-- guardare il resto della causale.
CREATE OR REPLACE FUNCTION public.cash_bank_is_customer_transfer(p_descr text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  WITH d AS (SELECT regexp_replace(COALESCE(p_descr, ''), 'ACC\.?\s*X\s*GIROC\.?\s*FRA\s*NOMIN\.?\s*DIV\.?', '', 'gi') AS t)
  SELECT d.t ~* '(\yBON\.\s*(IST|SEPA)\y|BONIFICO)'
     AND d.t !~* '(STIPEND|EMOLUMENT|SALARI\y|GIROCONTO|GIROC\.|\yF24\y|NOT[AE]\s+CR|RIMBORS|RESTITUZ|STORNO|LIQUIDAZ|RIACCREDIT|ACCREDITO\s+POS|PAGOBANCOMAT|American\s+Express)'
     AND public.cash_bank_circuit(d.t) IS NULL
     AND NOT public.cash_bank_is_deposit(d.t)
    FROM d;
$$;

-- ---------------------------------------------------------------------
-- 3. Riga «Bonifico» della chiusura ↔ bonifico/i in banca
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_customer_transfers_with_closings(
  p_company_id uuid DEFAULT NULL,
  p_from       date DEFAULT current_date - 90,
  p_tolerance  numeric DEFAULT 0.01
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r     record;
  v_ids uuid[];
  v_n   integer := 0;
BEGIN
  FOR r IN
    SELECT l.id AS line_id, l.closing_id, round(l.amount, 2) AS amount, c.company_id, c.closing_date
      FROM public.outlet_daily_closing_lines l
      JOIN public.outlet_payment_channels ch ON ch.id = l.channel_id
      JOIN public.outlet_daily_closings c ON c.id = l.closing_id
     WHERE ch.kind = 'bonifico'
       AND l.amount > 0
       AND c.status IN ('confermata', 'verificata')
       AND c.closing_date >= p_from
       AND (p_company_id IS NULL OR c.company_id = p_company_id)
       AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.line_id = l.id)
     ORDER BY c.closing_date, l.id
  LOOP
    v_ids := NULL;

    -- E1. Un bonifico solo con lo stesso importo: il piu' vicino alla chiusura,
    -- a parita' di distanza quello arrivato prima (il negozio registra dopo).
    SELECT ARRAY[bt.id] INTO v_ids
      FROM public.bank_transactions bt
     WHERE bt.company_id = r.company_id
       AND bt.amount > 0
       AND abs(bt.amount - r.amount) <= p_tolerance
       AND bt.transaction_date BETWEEN r.closing_date - 10 AND r.closing_date + 3
       AND COALESCE(bt.status, 'booked') IN ('posted', 'booked')
       AND public.cash_bank_is_customer_transfer(bt.description)
       AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
       AND NOT EXISTS (SELECT 1 FROM public.reconciliation_log rl WHERE rl.bank_transaction_id = bt.id AND rl.status = 'applied')
     ORDER BY abs(bt.transaction_date - r.closing_date), bt.transaction_date, bt.id
     LIMIT 1;

    -- E2. Due bonifici che sommano (due clienti lo stesso giorno).
    IF v_ids IS NULL THEN
      SELECT ARRAY[x.id, y.id] INTO v_ids
        FROM (SELECT bt.id, bt.amount, bt.transaction_date
                FROM public.bank_transactions bt
               WHERE bt.company_id = r.company_id AND bt.amount > 0 AND bt.amount < r.amount
                 AND bt.transaction_date BETWEEN r.closing_date - 10 AND r.closing_date + 3
                 AND COALESCE(bt.status, 'booked') IN ('posted', 'booked')
                 AND public.cash_bank_is_customer_transfer(bt.description)
                 AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
                 AND NOT EXISTS (SELECT 1 FROM public.reconciliation_log rl WHERE rl.bank_transaction_id = bt.id AND rl.status = 'applied')) x
        JOIN (SELECT bt.id, bt.amount, bt.transaction_date
                FROM public.bank_transactions bt
               WHERE bt.company_id = r.company_id AND bt.amount > 0 AND bt.amount < r.amount
                 AND bt.transaction_date BETWEEN r.closing_date - 10 AND r.closing_date + 3
                 AND COALESCE(bt.status, 'booked') IN ('posted', 'booked')
                 AND public.cash_bank_is_customer_transfer(bt.description)
                 AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
                 AND NOT EXISTS (SELECT 1 FROM public.reconciliation_log rl WHERE rl.bank_transaction_id = bt.id AND rl.status = 'applied')) y
          ON y.id > x.id
       WHERE abs(x.amount + y.amount - r.amount) <= p_tolerance
       ORDER BY abs(x.transaction_date - r.closing_date) + abs(y.transaction_date - r.closing_date), x.id, y.id
       LIMIT 1;
    END IF;

    IF v_ids IS NULL THEN
      -- Niente in banca: dopo 10 giorni la riga e' «mancante», prima resta in attesa.
      UPDATE public.outlet_daily_closing_lines
         SET bank_status = 'mancante'
       WHERE id = r.line_id AND bank_status = 'in_attesa' AND r.closing_date <= current_date - 10;
      CONTINUE;
    END IF;

    INSERT INTO public.closing_bank_matches (company_id, closing_id, line_id, bank_transaction_id, amount, match_type, reference_date, note)
    SELECT r.company_id, r.closing_id, r.line_id, bt.id, bt.amount, 'bonifico', r.closing_date,
           CASE WHEN array_length(v_ids, 1) > 1 THEN 'bonifico di cliente: ' || array_length(v_ids, 1) || ' bonifici per la riga Bonifico della chiusura' END
      FROM public.bank_transactions bt WHERE bt.id = ANY (v_ids)
    ON CONFLICT (bank_transaction_id, closing_id) DO NOTHING;

    UPDATE public.bank_transactions
       SET is_reconciled = true, reconciled_at = COALESCE(reconciled_at, now()), category = COALESCE(category, 'incassi_clienti'),
           note = CASE WHEN COALESCE(note, '') LIKE '%chiusura cassa%' THEN note
                       ELSE COALESCE(note || ' | ', '') || 'bonifico cliente abbinato a chiusura cassa del ' || to_char(r.closing_date, 'DD/MM/YYYY') END
     WHERE id = ANY (v_ids);

    UPDATE public.outlet_daily_closing_lines
       SET bank_amount = (SELECT round(sum(bt.amount), 2) FROM public.bank_transactions bt WHERE bt.id = ANY (v_ids)),
           bank_status = 'accreditato', bank_matched_at = now()
     WHERE id = r.line_id;

    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.match_customer_transfers_with_closings(uuid, date, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_customer_transfers_with_closings(uuid, date, numeric) TO service_role;

-- ---------------------------------------------------------------------
-- 4. Il riscontro notturno la chiama in coda (corpo della 224 + sezione E)
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
  v_amex      integer := 0;
  v_dep       integer := 0;
  v_verified  integer := 0;
  v_bon       integer := 0;
  r           record;
  v_line      record;
  v_kw        text;
  v_tx        record;
  v_cids      uuid[];
  v_lids      uuid[];
  v_dates     date[];
  v_decl      numeric[];
  v_n         integer;
  v_i         integer;
  v_j         integer;
  v_sum       numeric;
  v_tol       numeric;
  v_start     integer;
  v_end       integer;
  v_share     numeric;
  -- Amex dentro il flusso POS (accrediti MPS)
  v_ids          uuid[];
  v_amex_closing uuid;
  v_amex_lineid  uuid;
  v_amex_decl    numeric;
  v_amex_tx      uuid;
BEGIN
  -- A. Accrediti POS per (azienda, terminale, giorno di vendita)
  FOR r IN
    SELECT bt.company_id,
           public.cash_bank_terminal_code(bt.description) AS code,
           public.cash_bank_ref_date(bt.description)      AS ref_date,
           round(sum(bt.amount), 2)                       AS total,
           array_agg(bt.id)                               AS ids
      FROM public.bank_transactions bt
     WHERE bt.amount > 0
       AND bt.transaction_date >= v_from
       AND COALESCE(bt.status, 'booked') IN ('posted', 'booked')
       AND (p_company_id IS NULL OR bt.company_id = p_company_id)
       AND public.cash_bank_circuit(bt.description) = 'pos'
       AND public.cash_bank_terminal_code(bt.description) IS NOT NULL
       AND public.cash_bank_ref_date(bt.description) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
     GROUP BY 1, 2, 3
  LOOP
    v_ids := r.ids;

    -- A1. L'Amex passato dal POS MPS arriva con la stessa causale degli altri
    -- circuiti (nessun «American Express» da cercare) ma e' una riga a se', al
    -- LORDO: si riconosce perche' vale esattamente quanto la chiusura dichiara
    -- sul canale Amex di quel giorno. Se lo si lascia nel mucchio, il totale
    -- del terminale finisce scritto anche sulla riga Amex.
    v_amex_closing := NULL; v_amex_lineid := NULL; v_amex_decl := NULL; v_amex_tx := NULL;
    SELECT c.id, min(l.id::text)::uuid, round(sum(l.amount), 2)
      INTO v_amex_closing, v_amex_lineid, v_amex_decl
      FROM public.outlet_payment_channels ch
      JOIN public.outlet_daily_closings c ON c.outlet_id = ch.outlet_id AND c.closing_date = r.ref_date
      JOIN public.outlet_daily_closing_lines l ON l.closing_id = c.id AND l.channel_id = ch.id
     WHERE ch.company_id = r.company_id
       AND ch.is_active
       AND ch.kind = 'pos_amex'
       AND public.cash_bank_norm_code(ch.terminal_code) = r.code
       AND c.status IN ('confermata', 'verificata')
       AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.line_id = l.id)
     GROUP BY c.id
    HAVING round(sum(l.amount), 2) > 0
     LIMIT 1;

    IF v_amex_decl IS NOT NULL AND v_amex_decl > 0 THEN
      SELECT bt.id INTO v_amex_tx
        FROM public.bank_transactions bt
       WHERE bt.id = ANY (v_ids)
         AND abs(bt.amount - v_amex_decl) <= p_tolerance
       ORDER BY bt.id
       LIMIT 1;

      IF v_amex_tx IS NOT NULL THEN
        INSERT INTO public.closing_bank_matches (company_id, closing_id, line_id, bank_transaction_id, amount, match_type, reference_date)
        SELECT r.company_id, v_amex_closing, v_amex_lineid, bt.id, bt.amount, 'amex', r.ref_date
          FROM public.bank_transactions bt WHERE bt.id = v_amex_tx
        ON CONFLICT (bank_transaction_id, closing_id) DO NOTHING;

        UPDATE public.bank_transactions
           SET is_reconciled = true, reconciled_at = COALESCE(reconciled_at, now()), category = COALESCE(category, 'incassi_pos'),
               note = CASE WHEN COALESCE(note, '') LIKE '%chiusura cassa%' THEN note
                           ELSE COALESCE(note || ' | ', '') || 'Amex abbinato a chiusura cassa del ' || to_char(r.ref_date, 'DD/MM/YYYY') END
         WHERE id = v_amex_tx;

        v_amex := v_amex + 1;
        v_ids := array_remove(v_ids, v_amex_tx);
      END IF;
    END IF;

    IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN CONTINUE; END IF;

    -- A2. Quel che resta e' il POS degli altri circuiti.
    SELECT c.id AS closing_id, min(l.id::text)::uuid AS line_id
      INTO v_line
      FROM public.outlet_payment_channels ch
      JOIN public.outlet_daily_closings c ON c.outlet_id = ch.outlet_id AND c.closing_date = r.ref_date
      JOIN public.outlet_daily_closing_lines l ON l.closing_id = c.id AND l.channel_id = ch.id
     WHERE ch.company_id = r.company_id
       AND ch.is_active
       AND public.cash_bank_norm_code(ch.terminal_code) = r.code
       AND ch.kind = 'pos'
       AND c.status IN ('confermata', 'verificata')
     GROUP BY c.id
     LIMIT 1;
    IF NOT FOUND THEN CONTINUE; END IF;

    INSERT INTO public.closing_bank_matches (company_id, closing_id, line_id, bank_transaction_id, amount, match_type, reference_date)
    SELECT r.company_id, v_line.closing_id, v_line.line_id, bt.id, bt.amount, 'pos', r.ref_date
      FROM public.bank_transactions bt WHERE bt.id = ANY (v_ids)
    ON CONFLICT (bank_transaction_id, closing_id) DO NOTHING;

    UPDATE public.bank_transactions
       SET is_reconciled = true, reconciled_at = COALESCE(reconciled_at, now()), category = COALESCE(category, 'incassi_pos'),
           note = CASE WHEN COALESCE(note, '') LIKE '%chiusura cassa%' THEN note
                       ELSE COALESCE(note || ' | ', '') || 'abbinato a chiusura cassa del ' || to_char(r.ref_date, 'DD/MM/YYYY') END
     WHERE id = ANY (v_ids);
    v_pos := v_pos + 1;
  END LOOP;

  -- B. Accrediti Amex che arrivano con la loro causale (conto BCC): un solo
  -- accredito puo' coprire piu' giornate, quindi si cerca la sequenza.
  FOR r IN
    SELECT bt.company_id,
           public.cash_bank_terminal_code(bt.description) AS code,
           public.cash_bank_ref_date(bt.description)      AS ref_date,
           round(sum(bt.amount), 2)                       AS total,
           array_agg(bt.id)                               AS ids
      FROM public.bank_transactions bt
     WHERE bt.amount > 0
       AND bt.transaction_date >= v_from
       AND COALESCE(bt.status, 'booked') IN ('posted', 'booked')
       AND (p_company_id IS NULL OR bt.company_id = p_company_id)
       AND public.cash_bank_circuit(bt.description) = 'amex'
       AND public.cash_bank_terminal_code(bt.description) IS NOT NULL
       AND public.cash_bank_ref_date(bt.description) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
     GROUP BY 1, 2, 3
     ORDER BY 3
  LOOP
    SELECT array_agg(q.closing_id ORDER BY q.closing_date DESC),
           array_agg(q.line_id    ORDER BY q.closing_date DESC),
           array_agg(q.closing_date ORDER BY q.closing_date DESC),
           array_agg(q.declared   ORDER BY q.closing_date DESC),
           COALESCE(max(q.tol_pct), 0)
      INTO v_cids, v_lids, v_dates, v_decl, v_tol
      FROM (
        SELECT c.id AS closing_id, c.closing_date, min(l.id::text)::uuid AS line_id,
               round(sum(l.amount), 2) AS declared,
               -- Amex accredita il lordo: nessuno scarto da ammettere.
               max(CASE WHEN ch.settlement_mode = 'lordo' THEN 0 ELSE ch.bank_tolerance_pct END) AS tol_pct
          FROM public.outlet_payment_channels ch
          JOIN public.outlet_daily_closings c ON c.outlet_id = ch.outlet_id
          JOIN public.outlet_daily_closing_lines l ON l.closing_id = c.id AND l.channel_id = ch.id
         WHERE ch.company_id = r.company_id
           AND ch.is_active
           AND ch.kind = 'pos_amex'
           AND public.cash_bank_norm_code(ch.terminal_code) = r.code
           AND c.status IN ('confermata', 'verificata')
           AND c.closing_date BETWEEN r.ref_date - 10 AND r.ref_date
           AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.line_id = l.id)
         GROUP BY c.id, c.closing_date
        HAVING round(sum(l.amount), 2) > 0
      ) q;
    v_n := COALESCE(array_length(v_cids, 1), 0);
    IF v_n = 0 THEN CONTINUE; END IF;
    v_tol := GREATEST(p_tolerance, round(r.total * v_tol / 100, 2));

    v_start := NULL; v_end := NULL;
    <<search>>
    FOR v_i IN 1 .. v_n LOOP
      EXIT WHEN v_dates[v_i] < r.ref_date - 4;
      v_sum := 0;
      FOR v_j IN v_i .. v_n LOOP
        v_sum := v_sum + v_decl[v_j];
        IF abs(v_sum - r.total) <= v_tol THEN
          v_start := v_i; v_end := v_j;
          EXIT search;
        END IF;
        EXIT WHEN v_sum > r.total + v_tol;
      END LOOP;
    END LOOP;
    IF v_start IS NULL THEN CONTINUE; END IF;

    v_sum := 0;
    FOR v_j IN v_start .. v_end LOOP
      v_share := CASE WHEN v_j = v_end THEN round(r.total - v_sum, 2) ELSE v_decl[v_j] END;
      v_sum := v_sum + v_decl[v_j];
      INSERT INTO public.closing_bank_matches (company_id, closing_id, line_id, bank_transaction_id, amount, match_type, reference_date, note)
      SELECT r.company_id, v_cids[v_j], v_lids[v_j], bt.id,
             CASE WHEN r.total = 0 THEN 0 ELSE round(v_share * bt.amount / r.total, 2) END,
             'amex', v_dates[v_j],
             CASE WHEN v_end > v_start THEN 'accredito Amex del ' || to_char(r.ref_date, 'DD/MM/YYYY') || ' su ' || (v_end - v_start + 1) || ' giornate' END
        FROM public.bank_transactions bt WHERE bt.id = ANY (r.ids)
      ON CONFLICT (bank_transaction_id, closing_id) DO NOTHING;
    END LOOP;

    UPDATE public.bank_transactions
       SET is_reconciled = true, reconciled_at = COALESCE(reconciled_at, now()), category = COALESCE(category, 'incassi_pos'),
           note = CASE WHEN COALESCE(note, '') LIKE '%chiusura cassa%' THEN note
                       ELSE COALESCE(note || ' | ', '') || 'abbinato a chiusura cassa del ' || to_char(v_dates[v_end], 'DD/MM/YYYY')
                            || CASE WHEN v_end > v_start THEN ' - ' || to_char(v_dates[v_start], 'DD/MM/YYYY') ELSE '' END END
     WHERE id = ANY (r.ids);
    v_amex := v_amex + 1;
  END LOOP;

  -- C. Esito per riga di chiusura. Dove l'accredito e' lordo il confronto e'
  -- al centesimo; dove e' netto lo scarto ammesso e' la commissione.
  WITH grp AS (
    SELECT l.closing_id, public.cash_bank_norm_code(ch.terminal_code) AS code, ch.kind,
           round(sum(l.amount), 2) AS declared, array_agg(l.id) AS line_ids,
           max(CASE WHEN ch.settlement_mode = 'lordo' THEN 0 ELSE ch.bank_tolerance_pct END) AS tol_pct,
           min(c.closing_date) AS closing_date
      FROM public.outlet_daily_closing_lines l
      JOIN public.outlet_payment_channels ch ON ch.id = l.channel_id
      JOIN public.outlet_daily_closings c ON c.id = l.closing_id
     WHERE ch.kind IN ('pos', 'pos_amex')
       AND public.cash_bank_norm_code(ch.terminal_code) IS NOT NULL
       AND c.closing_date >= v_from - 30
       AND (p_company_id IS NULL OR l.company_id = p_company_id)
     GROUP BY 1, 2, 3
  ), bank AS (
    SELECT l.closing_id, public.cash_bank_norm_code(ch.terminal_code) AS code, ch.kind,
           round(sum(m.amount), 2) AS tot, max(m.matched_at) AS last_at
      FROM public.closing_bank_matches m
      JOIN public.outlet_daily_closing_lines l ON l.id = m.line_id
      JOIN public.outlet_payment_channels ch ON ch.id = l.channel_id
     WHERE m.line_id IS NOT NULL
     GROUP BY 1, 2, 3
  ), esito AS (
    SELECT g.line_ids, g.declared, b.tot, b.last_at,
           CASE WHEN abs(b.tot - g.declared) <= GREATEST(p_tolerance, round(g.declared * COALESCE(g.tol_pct, 0) / 100, 2))
                THEN 'accreditato'
                WHEN b.tot < g.declared AND g.closing_date > current_date - 5 THEN 'in_attesa'
                ELSE 'differenza' END AS st
      FROM grp g JOIN bank b ON b.closing_id = g.closing_id AND b.code = g.code AND b.kind = g.kind
  )
  UPDATE public.outlet_daily_closing_lines l
     SET bank_amount = e.tot, bank_status = e.st, bank_matched_at = e.last_at
    FROM esito e
   WHERE l.id = ANY (e.line_ids)
     AND (l.amount > 0 OR e.declared = 0)
     AND (l.bank_amount IS DISTINCT FROM e.tot OR l.bank_status IS DISTINCT FROM e.st);

  UPDATE public.outlet_daily_closing_lines l
     SET bank_status = CASE WHEN public.cash_bank_norm_code(ch.terminal_code) IS NULL THEN 'non_verificabile' ELSE 'mancante' END
    FROM public.outlet_daily_closings c, public.outlet_payment_channels ch
   WHERE c.id = l.closing_id AND ch.id = l.channel_id
     AND (p_company_id IS NULL OR l.company_id = p_company_id)
     AND ch.kind IN ('pos', 'pos_amex') AND l.amount > 0
     AND l.bank_status = 'in_attesa'
     AND c.status IN ('confermata', 'verificata')
     AND c.closing_date >= v_from
     AND (public.cash_bank_norm_code(ch.terminal_code) IS NULL
          OR c.closing_date <= current_date - CASE WHEN ch.kind = 'pos_amex' THEN 10 ELSE 5 END);

  -- D. Versamenti di contante (invariato)
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
      ON CONFLICT (bank_transaction_id, closing_id) DO NOTHING;
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

  -- E. Bonifici di clienti (238): la chiusura dichiara sul canale «Bonifico»
  -- quanto il negozio ha incassato con bonifico; in banca arrivano uno o due
  -- bonifici in entrata da privati. Logica in una funzione a se', cosi' si
  -- puo' rilanciare da sola su un periodo piu' lungo.
  v_bon := public.match_customer_transfers_with_closings(p_company_id, v_from - 30, p_tolerance);

  RETURN jsonb_build_object('gruppi_pos_abbinati', v_pos, 'accrediti_amex_abbinati', v_amex, 'versamenti_abbinati', v_dep,
                            'bonifici_clienti_abbinati', v_bon, 'chiusure_verificate', v_verified, 'run_at', now());
END;
$$;

-- Verifica:
--   SELECT match_cash_closings_with_bank(NULL, 60, 0.01);
--   SELECT c.closing_date, o.code, l.amount, l.bank_status, l.bank_amount
--     FROM outlet_daily_closing_lines l JOIN outlet_daily_closings c ON c.id = l.closing_id
--     JOIN outlet_payment_channels ch ON ch.id = l.channel_id JOIN outlets o ON o.id = c.outlet_id
--    WHERE ch.kind = 'bonifico' AND l.amount > 0 ORDER BY 1;
