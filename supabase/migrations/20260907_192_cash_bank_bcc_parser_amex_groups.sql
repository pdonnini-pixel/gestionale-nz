-- =====================================================================
-- 192 — Riscontro chiusure di cassa ↔ banca: causali BCC/Numia e canali
--       Amex doppi
-- ---------------------------------------------------------------------
-- 1. I parser riconoscono anche gli accrediti POS della BCC (acquirer
--    Numia / PagoBancomat), che hanno lo stesso schema "SIA + 5 cifre"
--    di MPS e Amex ma una causale diversa:
--      "Incassi PagoBancomat 29.08.26 - 618108700010 BRUGNATO 5 TERRE OUTLET"
--      "Incassi Internazionali Numia SpA 8063565 29.08.26 618108700010 ..."
--    Prima erano classificati "senza codice" e restavano fuori dal riscontro.
-- 2. Il matcher confronta l'accreditato con la SOMMA delle righe della
--    chiusura che hanno lo stesso codice terminale e lo stesso tipo (pos /
--    pos_amex): un outlet ha due canali Amex (POS MPS Amex e POS BCC Amex)
--    che in banca arrivano come un unico accredito Amex con un solo codice.
-- Nessuna modifica di schema. Additiva, idempotente. Tenant: NZ, Made, Zago.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Parser
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cash_bank_terminal_code(p_descr text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    -- MPS: "COD.SIA:6181087-00002"
    (regexp_match(COALESCE(p_descr, ''), 'COD\.?\s*SIA\s*:?\s*\d{5,}\s*-\s*(\d{5})', 'i'))[1],
    -- Amex: "618108700006 American Express"
    (regexp_match(COALESCE(p_descr, ''), '(\d{5})\s+American\s+Express', 'i'))[1],
    -- BCC / Numia / PagoBancomat: "PagoBancomat 29.08.26 - 618108700010" / "Numia SpA 8063565 29.08.26 618108700010"
    (regexp_match(COALESCE(p_descr, ''), '(?:PagoBancomat|Numia\s+S\.?p\.?A\.?\s+\d+)\s+\d{1,2}\.\d{1,2}\.\d{2,4}\s*-?\s*\d{7,}(\d{5})(?!\d)', 'i'))[1]
  );
$$;

CREATE OR REPLACE FUNCTION public.cash_bank_circuit(p_descr text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(p_descr, '') ~* 'American\s+Express' THEN 'amex'
    WHEN COALESCE(p_descr, '') ~* 'COD\.?\s*SIA' THEN 'pos'
    WHEN COALESCE(p_descr, '') ~* '(PagoBancomat|Numia\s+S\.?p\.?A)' THEN 'pos'
    ELSE NULL END;
$$;

CREATE OR REPLACE FUNCTION public.cash_bank_ref_date(p_descr text)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m text[];
BEGIN
  -- MPS: "DATA RIF.: 03.09.26"
  m := regexp_match(COALESCE(p_descr, ''), 'DATA\s*RIF\.?\s*:?\s*(\d{2})\.(\d{2})\.(\d{2,4})', 'i');
  IF m IS NOT NULL THEN
    RETURN make_date(CASE WHEN length(m[3]) = 2 THEN 2000 + m[3]::int ELSE m[3]::int END, m[2]::int, m[1]::int);
  END IF;
  -- Amex: "Accredito per incassi 02.09.2026"
  m := regexp_match(COALESCE(p_descr, ''), 'incassi\s+(\d{2})\.(\d{2})\.(\d{4})', 'i');
  IF m IS NOT NULL THEN
    RETURN make_date(m[3]::int, m[2]::int, m[1]::int);
  END IF;
  -- BCC / Numia / PagoBancomat: "PagoBancomat 29.08.26 - 6181087..." / "Numia SpA 8063565 29.08.26 6181087..."
  m := regexp_match(COALESCE(p_descr, ''), '(?:PagoBancomat|Numia\s+S\.?p\.?A\.?\s+\d+)\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s*-?\s*\d{7,}', 'i');
  IF m IS NOT NULL THEN
    RETURN make_date(CASE WHEN length(m[3]) = 2 THEN 2000 + m[3]::int ELSE m[3]::int END, m[2]::int, m[1]::int);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------
-- 2. Il riscontro (stessa firma di 188; cambiano A e A2)
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
BEGIN
  -- A. Accrediti POS/Amex non ancora abbinati, sommati per (azienda, terminale, circuito, giorno di riferimento)
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
    -- Le righe della chiusura CONFERMATA di quel giorno sui canali con quel terminale e quel tipo
    -- (piu' canali possono condividere il codice: es. "POS MPS Amex" e "POS BCC Amex"). Gli
    -- abbinamenti si agganciano alla prima riga; l'esito viene calcolato in A2 sul gruppo.
    SELECT c.id AS closing_id, min(l.id::text)::uuid AS line_id
      INTO v_line
      FROM public.outlet_payment_channels ch
      JOIN public.outlet_daily_closings c ON c.outlet_id = ch.outlet_id AND c.closing_date = r.ref_date
      JOIN public.outlet_daily_closing_lines l ON l.closing_id = c.id AND l.channel_id = ch.id
     WHERE ch.company_id = r.company_id
       AND ch.is_active
       AND public.cash_bank_norm_code(ch.terminal_code) = r.code
       AND ch.kind = CASE WHEN r.circuit = 'amex' THEN 'pos_amex' ELSE 'pos' END
       AND c.status IN ('confermata', 'verificata')
     GROUP BY c.id
     LIMIT 1;
    IF NOT FOUND THEN CONTINUE; END IF;  -- chiusura non ancora confermata o canale non mappato: si riprova domani

    INSERT INTO public.closing_bank_matches (company_id, closing_id, line_id, bank_transaction_id, amount, match_type, reference_date)
    SELECT r.company_id, v_line.closing_id, v_line.line_id, bt.id, bt.amount, CASE WHEN r.circuit = 'amex' THEN 'amex' ELSE 'pos' END, r.ref_date
      FROM public.bank_transactions bt WHERE bt.id = ANY (r.ids)
    ON CONFLICT (bank_transaction_id) DO NOTHING;

    UPDATE public.bank_transactions
       SET is_reconciled = true, reconciled_at = COALESCE(reconciled_at, now()), category = COALESCE(category, 'incassi_pos'),
           note = CASE WHEN COALESCE(note, '') LIKE '%chiusura cassa%' THEN note
                       ELSE COALESCE(note || ' | ', '') || 'abbinato a chiusura cassa del ' || to_char(r.ref_date, 'DD/MM/YYYY') END
     WHERE id = ANY (r.ids);
    v_pos := v_pos + 1;
  END LOOP;

  -- A2. Esito per gruppo (chiusura, codice terminale, tipo): accreditato in banca vs somma dichiarata
  --     sulle righe del gruppo. Tutte le righe del gruppo ricevono lo stesso esito e lo stesso
  --     importo bancario (le righe a zero restano in attesa, salvo che l'intero gruppo sia a zero).
  WITH grp AS (
    SELECT l.closing_id, public.cash_bank_norm_code(ch.terminal_code) AS code, ch.kind,
           round(sum(l.amount), 2) AS declared, array_agg(l.id) AS line_ids
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
           CASE WHEN abs(b.tot - g.declared) <= p_tolerance THEN 'accreditato' ELSE 'differenza' END AS st
      FROM grp g JOIN bank b ON b.closing_id = g.closing_id AND b.code = g.code AND b.kind = g.kind
  )
  UPDATE public.outlet_daily_closing_lines l
     SET bank_amount = e.tot, bank_status = e.st, bank_matched_at = e.last_at
    FROM esito e
   WHERE l.id = ANY (e.line_ids)
     AND (l.amount > 0 OR e.declared = 0)
     AND (l.bank_amount IS DISTINCT FROM e.tot OR l.bank_status IS DISTINCT FROM e.st);

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

-- ---------------------------------------------------------------------
-- Verifica (da eseguire su ogni tenant)
-- ---------------------------------------------------------------------
-- SELECT public.cash_bank_terminal_code('Incassi PagoBancomat 29.08.26 - 618108700010 BRUGNATO 5 TERRE OUTLET');          -- 00010
-- SELECT public.cash_bank_ref_date('Incassi Internazionali Numia SpA 8063565 29.08.26 618108700010 BRUGNATO 5 TERRE');  -- 2026-08-29
-- SELECT public.cash_bank_circuit('Incassi Internazionali Numia SpA 8063565 29.08.26 618108700010 X');                 -- pos
