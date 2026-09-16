-- ROLLBACK 238 — Riscontro bonifici clienti
-- Ripristina match_cash_closings_with_bank della 224 (senza la sezione E) e
-- toglie le due funzioni nuove. Il vincolo su match_type resta esteso a
-- 'bonifico' e le righe di closing_bank_matches gia' scritte restano:
-- toglierle sarebbe una DELETE su dati vivi (REGOLA NO DATA LOSS), si fa
-- solo a mano con conferma.
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

  RETURN jsonb_build_object('gruppi_pos_abbinati', v_pos, 'accrediti_amex_abbinati', v_amex, 'versamenti_abbinati', v_dep,
                            'chiusure_verificate', v_verified, 'run_at', now());
END;
$$;

DROP FUNCTION IF EXISTS public.match_customer_transfers_with_closings(uuid, date, numeric);
DROP FUNCTION IF EXISTS public.cash_bank_is_customer_transfer(text);
