-- =====================================================================
-- Migrazione 149 — Riconciliazione: numero fattura "corto" negli addebiti SDD
--                  (progressivo SDI dentro il sezionale)
-- =====================================================================
-- CASO REALE (New Zago, 28/07/2026, ENEGAN):
--   Movimento −2.576,70 "ADDEBITO SDD … A FAVORE ENEGAN … FT 755213 … FT 755215
--   … FT 755217 … FT 755219 … FT 755221". Le 5 fatture aperte sommano ESATTAMENTE
--   2.576,70, ma NON si erano chiuse in automatico né comparivano tra i gruppi da
--   confermare a mano.
--
-- CAUSA RADICE: i matcher di gruppo cercano nel causale il numero fattura ridotto
--   a SOLE CIFRE e concatenato. In gestionale la fattura è "26/20005.0755213" →
--   il matcher cerca "26200050755213" (14 cifre), ma la banca cita solo "FT 755213"
--   (il progressivo del documento, senza il sezionale "26/20005."). Il numero intero
--   non compare mai → nessuna fattura riconosciuta → nessun gruppo → niente aggancio.
--   (Stesso motivo per cui il gemello −2.058,38 non si era chiuso da solo: agganciato
--   a mano dall'operatrice.)
--
-- FIX: due helper puri che estraggono TUTTE le chiavi numeriche utili da un numero
--   fattura — il concatenato completo E ogni segmento "lungo" (>= 6 cifre, es. il
--   progressivo "0755213") — e verificano se una di esse è citata come token isolato
--   nel causale. I tre matcher (nome, numeri, guardia utenze) usano l'helper al posto
--   del solo concatenato. I segmenti < 6 cifre (anno "2026", sezionale "20005") NON
--   diventano chiavi: nessun rischio di falsi positivi sull'anno. La guardia granitica
--   resta invariata: fornitore confermato in causale + SOMMA del gruppo esatta al
--   centesimo. Additiva, reversibile (undo_reconcile_movement).
--
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago.
-- Dopo l'apply, per lo storico:  SELECT public.rerun_group_reconciliation();
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Helper puri: chiavi numeriche di un numero fattura + "citato in causale?"
-- ---------------------------------------------------------------------
-- Chiavi = { concatenato di tutte le cifre } ∪ { ogni segmento numerico >= 6 cifre },
-- ciascuna anche senza zeri iniziali. Es. "26/20005.0755213" →
--   {"26200050755213", "0755213", "755213"}. Il "755213" è ciò che la banca cita.
-- I segmenti corti (anno, sezionale) sono esclusi di proposito.
CREATE OR REPLACE FUNCTION public.invoice_number_keys(p_inv text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH toks AS (
    SELECT regexp_replace(coalesce(p_inv, ''), '[^0-9]', '', 'g') AS k   -- concatenato completo
    UNION ALL
    SELECT m[1] FROM regexp_matches(coalesce(p_inv, ''), '([0-9]{6,})', 'g') m  -- segmenti lunghi (>=6)
  )
  SELECT ARRAY(
    SELECT DISTINCT v FROM (
      SELECT k AS v FROM toks WHERE k <> ''
      UNION ALL
      SELECT ltrim(k, '0') FROM toks WHERE ltrim(k, '0') <> ''
    ) x
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.invoice_number_keys(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_number_keys(text) TO authenticated, service_role;

-- Vero se una chiave del numero fattura (lunga almeno p_min_len) compare come TOKEN
-- ISOLATO (delimitato da non-cifre) nel testo del causale. p_descr atteso già lower().
CREATE OR REPLACE FUNCTION public.invoice_cited_in_text(p_inv text, p_descr text, p_min_len int)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(public.invoice_number_keys(p_inv)) k
    WHERE length(k) >= p_min_len
      AND p_descr ~ ('(^|[^0-9])' || k || '([^0-9]|$)')
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.invoice_cited_in_text(text, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_cited_in_text(text, text, int) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1) Matcher granitico a NOME: usa l'helper per il ramo numerico (full-concat >=4
--    OPPURE segmento lungo >=6). Rami "corto" (2-3 cifre) e alfanumerico invariati.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_match_group_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bt RECORD;
  v_descr TEXT;
  v_mov NUMERIC;
  v_grp RECORD;
  v_pay RECORD;
  v_first UUID := NULL;
  v_linked INT := 0;
  v_applied NUMERIC;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing');
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;

  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));
  v_mov := abs(v_bt.amount);

  SELECT g.supplier_name, g.ids, g.tot INTO v_grp
  FROM (
    SELECT q.supplier_name, array_agg(q.id) AS ids, sum(q.amt) AS tot
    FROM (
      SELECT p.id, p.supplier_name,
        CASE WHEN p.status = 'pagato' THEN p.gross_amount
             ELSE COALESCE(p.amount_remaining, p.gross_amount - COALESCE(p.amount_paid, 0), p.gross_amount) END AS amt
      FROM public.payables p
      WHERE p.company_id = v_bt.company_id
        AND p.bank_transaction_id IS NULL
        AND p.gross_amount > 0
        AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto', 'pagato')  -- R2: incluse le pagato senza aggancio
        AND public.supplier_confirmed_in_text(p.supplier_name, p.supplier_vat, v_descr)
        AND (
          -- numero NUMERICO: concatenato completo (>=4) OPPURE segmento lungo (>=6 cifre,
          -- es. il progressivo SDI "0755213" dentro "26/20005.0755213", che in banca
          -- compare come "FT 755213").
          public.invoice_cited_in_text(coalesce(p.invoice_number, ''), v_descr, 4)
          OR
          -- numero "corto" (2-3 cifre): ammesso SOLO con contesto fattura in causale
          -- (saldo/fattura/fatt/nota/parcella) e token isolato. La somma esatta del
          -- gruppo (HAVING sotto) resta il vincolo granitico: copre "SALDO FATTURA 11-12".
          ( length(ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0')) BETWEEN 2 AND 3
            AND v_descr ~ '(saldo|fattura|fatt|nota|parcella)'
            AND v_descr ~ ('(^|[^0-9])' || ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0') || '([^0-9]|$)') )
          OR
          -- numero ALFANUMERICO con separatori (es. "26-0564", "FI 000458", "B0202600536"):
          -- match come token isolato tollerando i separatori (come il matcher a punteggio).
          ( length(regexp_replace(lower(coalesce(p.invoice_number, '')), '[^a-z0-9]', '', 'g')) >= 4
            AND v_descr ~ ('(^|[^a-z0-9])' || regexp_replace(lower(trim(coalesce(p.invoice_number, ''))), '[^a-z0-9]+', '[^a-z0-9]{0,3}', 'g') || '([^a-z0-9]|$)') )
        )
    ) q
    GROUP BY q.supplier_name
    HAVING abs(sum(q.amt) - v_mov) <= GREATEST(0.02, v_mov * 0.01)
    ORDER BY count(*) DESC
    LIMIT 1
  ) g;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false);
  END IF;

  FOR v_pay IN SELECT * FROM public.payables WHERE id = ANY(v_grp.ids) LOOP
    IF v_first IS NULL THEN v_first := v_pay.id; END IF;

    IF v_pay.status = 'pagato' AND v_pay.bank_transaction_id IS NULL THEN  -- R2: già pagata → solo aggancio
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount,
              'auto: fattura citata in causale (già pagata — solo aggancio)');
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables
      SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
          payment_date = v_bt.transaction_date,
          bank_transaction_id = p_bt_id,
          updated_at = now()
      WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_applied,
              'auto: fattura citata in causale (importo esatto)');
    END IF;
    v_linked := v_linked + 1;
  END LOOP;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('matched', true, 'auto', true, 'grouped', (v_linked > 1),
                            'linked', v_linked, 'supplier', v_grp.supplier_name, 'sum', v_grp.tot, 'movimento', v_mov);
END;
$function$;

-- ---------------------------------------------------------------------
-- 2) Matcher granitico GUIDATO DAI NUMERI: usa l'helper (>=6 cifre) al posto del
--    solo concatenato. Copre gli SDD cumulativi con progressivo "corto" in causale.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_match_group_numbers_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bt RECORD; v_descr TEXT; v_mov NUMERIC; v_cnt INT; v_ids uuid[]; v_tot NUMERIC;
  v_pay RECORD; v_first UUID := NULL; v_linked INT := 0; v_applied NUMERIC;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing'); END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled'); END IF;
  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));
  v_mov := abs(v_bt.amount);
  WITH hits AS (
    SELECT p.id, COALESCE(p.supplier_id::text, p.supplier_name) AS sid,
           CASE WHEN p.status = 'pagato' THEN p.gross_amount
                ELSE COALESCE(p.amount_remaining, p.gross_amount - COALESCE(p.amount_paid, 0), p.gross_amount) END AS amt
    FROM public.payables p
    WHERE p.company_id = v_bt.company_id AND p.bank_transaction_id IS NULL AND p.gross_amount > 0
      AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto', 'pagato')
      AND public.invoice_cited_in_text(coalesce(p.invoice_number, ''), v_descr, 6)
  ),
  grp AS (
    SELECT sid, array_agg(id) AS ids, sum(amt) AS tot FROM hits GROUP BY sid
    HAVING abs(sum(amt) - v_mov) <= GREATEST(0.02, v_mov * 0.01)
  )
  SELECT (SELECT count(*) FROM grp), g.ids, g.tot INTO v_cnt, v_ids, v_tot FROM grp g LIMIT 1;
  IF v_cnt IS NULL OR v_cnt <> 1 THEN RETURN jsonb_build_object('matched', false, 'reason', 'ambiguous_or_none'); END IF;
  FOR v_pay IN SELECT * FROM public.payables WHERE id = ANY(v_ids) LOOP
    IF v_first IS NULL THEN v_first := v_pay.id; END IF;
    IF v_pay.status = 'pagato' AND v_pay.bank_transaction_id IS NULL THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount, 'auto: numero fattura citato in causale — SDD cumulativo (già pagata, solo aggancio)');
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables SET amount_paid = COALESCE(amount_paid, 0) + v_applied, payment_date = v_bt.transaction_date, bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_applied, 'auto: numero fattura citato in causale — SDD cumulativo (importo esatto)');
    END IF;
    v_linked := v_linked + 1;
  END LOOP;
  UPDATE public.bank_transactions SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first WHERE id = p_bt_id;
  RETURN jsonb_build_object('matched', true, 'auto', true, 'grouped', (v_linked > 1), 'linked', v_linked, 'sum', v_tot, 'movimento', v_mov, 'by', 'invoice_numbers');
END;
$function$;

-- ---------------------------------------------------------------------
-- 3) close_utility_movements: la guardia "c'è una fattura da agganciare?" usa l'helper
--    (>=6 cifre) — così un SDD utenza che cita FT 755213 NON viene chiuso come utenza
--    generica prima che il matcher agganci le fatture (la fattura ha sempre la precedenza).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_utility_movements()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n INT;
BEGIN
  WITH upd AS (
    UPDATE public.bank_transactions bt
    SET is_reconciled = true, reconciled_at = now(), category = COALESCE(bt.category, 'utenze'),
        note = COALESCE(bt.note || ' | ', '') || 'chiuso automaticamente (utenza — addebito permanente)'
    WHERE bt.amount < 0 AND COALESCE(bt.is_reconciled, false) = false AND bt.status IN ('posted', 'booked')
      AND NOT EXISTS (SELECT 1 FROM public.reconciliation_log rl WHERE rl.bank_transaction_id = bt.id AND rl.status IN ('applied', 'to_confirm'))
      AND NOT EXISTS (
        SELECT 1 FROM public.payables p2
        WHERE p2.company_id = bt.company_id AND p2.bank_transaction_id IS NULL AND p2.gross_amount > 0
          AND public.invoice_cited_in_text(
                coalesce(p2.invoice_number, ''),
                lower(coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '')), 6))
      AND EXISTS (
        SELECT 1 FROM public.suppliers s
        WHERE s.company_id = bt.company_id AND COALESCE(s.is_utility, false) = true
          AND public.supplier_confirmed_in_text_strict(s.name, COALESCE(s.vat_number, s.partita_iva), coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '')))
    RETURNING bt.id
  )
  SELECT count(*) INTO v_n FROM upd;
  RETURN jsonb_build_object('chiusi_utenze', v_n);
END;
$function$;
