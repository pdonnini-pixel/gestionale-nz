-- =====================================================================
-- 195 — Riscontro chiusure di cassa ↔ banca: commissioni e accrediti Amex
-- ---------------------------------------------------------------------
-- Dal collaudo sugli scontrini reali (1-6 settembre 2026, 42 chiusure):
-- 1. Gli accrediti POS di MPS arrivano AL NETTO delle commissioni (0,4-1,1 %
--    in meno della chiusura POS, senza riga di commissione separata) per
--    tutti i terminali tranne uno che riceve il lordo. Con la tolleranza di
--    un centesimo il riscontro segnava "differenza" quasi ogni giorno.
--    → nuova colonna outlet_payment_channels.bank_tolerance_pct: scarto
--      percentuale ammesso fra dichiarato e accreditato (default 1,5 % sui
--      canali POS esistenti, 0 sugli altri; modificabile in Incassi
--      giornalieri → Canali di incasso).
-- 2. Gli accrediti American Express portano in causale la data
--    dell'ACCREDITO, non quella della vendita, e un solo accredito copre
--    piu' giorni di vendita (fine settimana, giorni con pochi Amex).
--    → per gli Amex il matcher cerca la sequenza di giornate consecutive
--      (fino a 10 giorni prima dell'accredito) la cui somma dichiarata sul
--      canale Amex coincide con l'accreditato, e registra un abbinamento
--      per ogni giornata con la sua quota. closing_bank_matches passa da
--      UNIQUE (bank_transaction_id) a UNIQUE (bank_transaction_id, closing_id).
--    → le righe Amex passano a "mancante" dopo 10 giorni (non 5).
-- Additiva, idempotente, nessun valore di tenant. Tenant: NZ, Made, Zago.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tolleranza per canale
-- ---------------------------------------------------------------------
ALTER TABLE public.outlet_payment_channels
  ADD COLUMN IF NOT EXISTS bank_tolerance_pct numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE public.outlet_payment_channels
  DROP CONSTRAINT IF EXISTS outlet_payment_channels_bank_tolerance_pct_check;
ALTER TABLE public.outlet_payment_channels
  ADD CONSTRAINT outlet_payment_channels_bank_tolerance_pct_check
  CHECK (bank_tolerance_pct >= 0 AND bank_tolerance_pct <= 10);
COMMENT ON COLUMN public.outlet_payment_channels.bank_tolerance_pct IS
  'Scarto % ammesso fra importo dichiarato e accreditato in banca (commissioni trattenute dall''acquirer). 0 = solo il centesimo.';

-- Canali POS gia' presenti: 1,5 % (copre le commissioni MPS osservate, 0,4-1,1 %)
UPDATE public.outlet_payment_channels
   SET bank_tolerance_pct = 1.5
 WHERE kind = 'pos' AND bank_tolerance_pct = 0;

-- ---------------------------------------------------------------------
-- 2. Un accredito puo' coprire piu' chiusure (Amex)
-- ---------------------------------------------------------------------
ALTER TABLE public.closing_bank_matches
  DROP CONSTRAINT IF EXISTS closing_bank_matches_bank_transaction_id_key;
ALTER TABLE public.closing_bank_matches
  DROP CONSTRAINT IF EXISTS closing_bank_matches_tx_closing_key;
ALTER TABLE public.closing_bank_matches
  ADD CONSTRAINT closing_bank_matches_tx_closing_key UNIQUE (bank_transaction_id, closing_id);

-- ---------------------------------------------------------------------
-- 3. Il riscontro (stessa firma di 188/192)
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
  r           record;
  v_line      record;
  v_kw        text;
  v_tx        record;
  -- Amex: candidate giornate (dalla piu' recente) e ricerca della sequenza
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
BEGIN
  -- A. Accrediti POS (carte/bancomat) non ancora abbinati, sommati per (azienda, terminale, giorno di vendita)
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
    IF NOT FOUND THEN CONTINUE; END IF;  -- chiusura non ancora confermata o canale non mappato: si riprova domani

    INSERT INTO public.closing_bank_matches (company_id, closing_id, line_id, bank_transaction_id, amount, match_type, reference_date)
    SELECT r.company_id, v_line.closing_id, v_line.line_id, bt.id, bt.amount, 'pos', r.ref_date
      FROM public.bank_transactions bt WHERE bt.id = ANY (r.ids)
    ON CONFLICT (bank_transaction_id, closing_id) DO NOTHING;

    UPDATE public.bank_transactions
       SET is_reconciled = true, reconciled_at = COALESCE(reconciled_at, now()), category = COALESCE(category, 'incassi_pos'),
           note = CASE WHEN COALESCE(note, '') LIKE '%chiusura cassa%' THEN note
                       ELSE COALESCE(note || ' | ', '') || 'abbinato a chiusura cassa del ' || to_char(r.ref_date, 'DD/MM/YYYY') END
     WHERE id = ANY (r.ids);
    v_pos := v_pos + 1;
  END LOOP;

  -- A-bis. Accrediti Amex: la data in causale e' quella dell'accredito e un accredito copre piu'
  --        giornate. Si cercano le giornate consecutive (con Amex dichiarato sul canale con quel
  --        codice, fino a 10 giorni prima) la cui somma coincide con l'accreditato.
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
    -- Giornate candidate: chiusure confermate con Amex dichiarato > 0 sul codice, non ancora abbinate, dalla piu' recente
    SELECT array_agg(q.closing_id ORDER BY q.closing_date DESC),
           array_agg(q.line_id    ORDER BY q.closing_date DESC),
           array_agg(q.closing_date ORDER BY q.closing_date DESC),
           array_agg(q.declared   ORDER BY q.closing_date DESC),
           COALESCE(max(q.tol_pct), 0)
      INTO v_cids, v_lids, v_dates, v_decl, v_tol
      FROM (
        SELECT c.id AS closing_id, c.closing_date, min(l.id::text)::uuid AS line_id,
               round(sum(l.amount), 2) AS declared, max(ch.bank_tolerance_pct) AS tol_pct
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

    -- Sequenza consecutiva (nell'elenco delle candidate) che somma all'accreditato; la giornata piu'
    -- recente della sequenza deve stare entro 4 giorni dall'accredito.
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
    IF v_start IS NULL THEN CONTINUE; END IF;  -- nessuna sequenza: si riprova domani (dopo 10 giorni la riga Amex passa a "mancante")

    -- Un abbinamento per giornata con la sua quota (l'ultima assorbe lo scarto di tolleranza)
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

  -- A2. Esito per gruppo (chiusura, codice terminale, tipo): accreditato in banca vs somma dichiarata
  --     sulle righe del gruppo, con la tolleranza percentuale del canale (commissioni trattenute).
  WITH grp AS (
    SELECT l.closing_id, public.cash_bank_norm_code(ch.terminal_code) AS code, ch.kind,
           round(sum(l.amount), 2) AS declared, array_agg(l.id) AS line_ids,
           max(ch.bank_tolerance_pct) AS tol_pct
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
                THEN 'accreditato' ELSE 'differenza' END AS st
      FROM grp g JOIN bank b ON b.closing_id = g.closing_id AND b.code = g.code AND b.kind = g.kind
  )
  UPDATE public.outlet_daily_closing_lines l
     SET bank_amount = e.tot, bank_status = e.st, bank_matched_at = e.last_at
    FROM esito e
   WHERE l.id = ANY (e.line_ids)
     AND (l.amount > 0 OR e.declared = 0)
     AND (l.bank_amount IS DISTINCT FROM e.tot OR l.bank_status IS DISTINCT FROM e.st);

  -- A3. Righe POS/Amex con importo, chiusura confermata, senza accredito dopo 5 giorni (10 per Amex)
  --     → mancante; canale senza codice terminale → non verificabile.
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

  RETURN jsonb_build_object('gruppi_pos_abbinati', v_pos, 'accrediti_amex_abbinati', v_amex, 'versamenti_abbinati', v_dep,
                            'chiusure_verificate', v_verified, 'run_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.match_cash_closings_with_bank(uuid, integer, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_cash_closings_with_bank(uuid, integer, numeric) TO service_role;

-- ---------------------------------------------------------------------
-- Verifica (da eseguire su ogni tenant)
-- ---------------------------------------------------------------------
-- SELECT kind, bank_tolerance_pct, count(*) FROM public.outlet_payment_channels GROUP BY 1, 2;
-- SELECT conname FROM pg_constraint WHERE conrelid = 'public.closing_bank_matches'::regclass AND contype = 'u';
--   -- closing_bank_matches_tx_closing_key
