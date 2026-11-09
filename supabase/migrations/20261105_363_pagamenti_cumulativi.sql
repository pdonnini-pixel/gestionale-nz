-- ============================================================================
-- 363 — Pagamenti cumulativi: effetti ritirati e addebiti diretti di più fatture
-- ============================================================================
-- Nata il 05/11/2026 dal conteggio delle 92 scadenze chiuse in via provvisoria su NZ
-- (87.985,05 €). Due casi, entrambi pagati davvero e mai agganciati al movimento:
--
-- 1. EFFETTI RITIRATI. MPS addebita in un movimento solo gli effetti di una data,
--    «NUM.EFFETTI: n», più 0,40 € di commissione per effetto. Il 10/09/2026:
--    6.758,24 = Arco 648,14 + Gladiotex 3.250,08 + Axet 290,83 + Humatics 2.567,59
--    (tre fatture in un effetto) + 4 × 0,40. Gli effetti stavano nella distinta del
--    31/08, caricata quando non erano ancora scaduti: `apply_riba_distinta` li
--    riconosce ma non li applica, e l'addebito arriva dopo. Nessuna regola li
--    riprendeva.
-- 2. ADDEBITI DIRETTI CUMULATIVI. Valdichiana Propco l'08/10 (39.431,13 =
--    27.946,78 + 9.654,35 + 6 × 305,00) e Frankie Retail Holdco il 09/10 (32.938,06 =
--    23.048,85 + 9.889,21). La causale cita numeri di documento del creditore
--    (20260001575…) diversi dai numeri delle fatture (B01926001581…), quindi
--    `try_match_group_bank_transaction`, che vuole le fatture citate, non li vede.
--    Torna solo la somma, al centesimo.
--
-- COSA FA
-- · `try_match_effetti_ritirati_bank_transaction`: per un addebito «EFFETTI RITIRATI»
--   con «NUM.EFFETTI: n» cerca, nelle distinte confermate dello stesso conto, gli n
--   effetti con scadenza nei 7 giorni prima (o il giorno dopo) la cui somma più
--   0,40 € a effetto (oppure senza commissione) torna al centesimo. Solo se la
--   combinazione è UNA. Aggancia le rate, chiude quelle ancora aperte alla scadenza
--   dell'effetto, compensa le note di credito dell'effetto come `apply_riba_distinta`.
-- · `try_match_sdd_sum_bank_transaction`: per un addebito diretto (SDD/RID) cerca le
--   scadenze a addebito diretto di UN fornitore confermato nella causale
--   (`supplier_confirmed_in_text`, la stessa conferma del motore), scadute da non più
--   di 45 giorni o in scadenza entro 10, la cui somma torna al centesimo. Solo se la
--   combinazione di scadenze è UNA.
-- · `rerun_cumulative_reconciliation`: le prova sui movimenti in uscita non
--   riconciliati degli ultimi 180 giorni. Entra in `run_daily_reconciliation` subito
--   dopo i raggruppati e prima delle chiusure provvisorie.
--
-- COSA NON FA
-- · non tocca movimenti già riconciliati né rate già agganciate a un movimento;
-- · non sceglie fra due combinazioni che tornano entrambe: in quel caso non fa niente;
-- · una rata già chiusa (anche in via provvisoria) riceve solo l'aggancio: importo
--   pagato e data restano quelli che ha, come in `try_match_group_bank_transaction`.
--
-- Misura del 05/11/2026 prima dell'applicazione (NZ): 3 movimenti (10/09, 08/10,
-- 09/10), 16 rate, 79.125,83 €. Gli affitti dell'08/10 e del 09/10 sono stati poi
-- agganciati a mano lo stesso giorno (pagamento raggruppato): alla 363 resta il 10/09.
-- La 362 di main (gruppo per nome e somma esatta) prende solo scadenze aperte, non
-- le provvisorie: le due regole non si sovrappongono.
-- Tenant: NZ e Zago (Made escluso dal 03/11/2026, vedi CLAUDE.md).
-- Rollback: 20261105_363_pagamenti_cumulativi_ROLLBACK.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Effetti ritirati
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_match_effetti_ritirati_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD; v_mov numeric; v_n int; v_cand int; v_sets int;
  v_lines uuid[]; v_first uuid := NULL; v_linked int := 0;
  v_pay RECORD; v_line RECORD; v_note text;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing');
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;
  IF COALESCE(v_bt.description, '') !~* 'EFFETTI\s+RITIRATI' THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_effetti_ritirati');
  END IF;
  v_n := (substring(v_bt.description FROM '(?i)NUM\.?\s*EFFETTI\s*:?\s*([0-9]{1,3})'))::int;
  IF v_n IS NULL OR v_n < 1 OR v_n > 12 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'num_effetti_missing');
  END IF;
  v_mov := abs(v_bt.amount);

  -- Effetti candidati: distinte confermate dello stesso conto, scadenza vicina,
  -- nessuna rata dell'effetto già agganciata a un movimento o annullata.
  CREATE TEMP TABLE IF NOT EXISTS _eff_cand (k int, line_id uuid, amt numeric) ON COMMIT DROP;
  TRUNCATE _eff_cand;
  INSERT INTO _eff_cand (k, line_id, amt)
  SELECT row_number() OVER (ORDER BY rl.raw_due_date, rl.id), rl.id, rl.raw_amount
  FROM public.riba_distinta_lines rl
  JOIN public.riba_distinte rd ON rd.id = rl.distinta_id
  WHERE rd.company_id = v_bt.company_id
    AND rd.status = 'confermata'
    AND rd.bank_account_id = v_bt.bank_account_id
    AND rl.match_status IN ('confirmed', 'matched')
    AND rl.raw_amount > 0
    AND rl.raw_due_date BETWEEN v_bt.transaction_date - 7 AND v_bt.transaction_date + 1
    AND COALESCE(array_length(rl.matched_payable_ids, 1), 0) > 0
    AND NOT EXISTS (SELECT 1 FROM public.payables py
                    WHERE py.id = ANY (rl.matched_payable_ids)
                      AND (py.bank_transaction_id IS NOT NULL OR COALESCE(py.status::text, '') = 'annullato'));
  SELECT count(*) INTO v_cand FROM _eff_cand;
  IF v_cand < v_n OR v_cand > 16 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'candidates_out_of_range', 'candidates', v_cand);
  END IF;

  -- Combinazioni di n effetti la cui somma, con 0,40 € a effetto o senza, torna.
  WITH RECURSIVE combo AS (
    SELECT c.k, ARRAY[c.line_id] AS ids, c.amt AS tot, 1 AS cnt FROM _eff_cand c
    UNION ALL
    SELECT c.k, combo.ids || c.line_id, combo.tot + c.amt, combo.cnt + 1
    FROM combo JOIN _eff_cand c ON c.k > combo.k
    WHERE combo.cnt < v_n AND combo.tot + c.amt <= v_mov + 0.01
  ), ok AS (
    SELECT ids FROM combo
    WHERE cnt = v_n
      AND (abs(v_mov - tot - 0.40 * v_n) <= 0.01 OR abs(v_mov - tot) <= 0.01)
  )
  -- Una riga per combinazione; con LIMIT 2 si sa se è una sola. (array_agg su un
  -- uuid[] darebbe un array a due dimensioni: si prende la riga, non l'aggregato.)
  SELECT z.ids, count(*) OVER () INTO v_lines, v_sets FROM (SELECT ids FROM ok LIMIT 2) z LIMIT 1;
  v_sets := COALESCE(v_sets, 0);
  IF v_sets <> 1 THEN
    RETURN jsonb_build_object('matched', false, 'reason',
      CASE WHEN v_sets = 0 THEN 'no_combination' ELSE 'ambiguous' END);
  END IF;

  v_note := 'auto (effetti ritirati): addebito MPS di ' || v_n || ' effetti del '
            || to_char(v_bt.transaction_date, 'DD/MM/YYYY') || ', somma degli effetti in distinta';

  FOR v_line IN SELECT * FROM public.riba_distinta_lines WHERE id = ANY (v_lines) LOOP
    FOR v_pay IN SELECT * FROM public.payables WHERE id = ANY (v_line.matched_payable_ids) ORDER BY gross_amount DESC LOOP
      IF v_pay.gross_amount < 0 THEN
        -- Nota di credito compensata nell'effetto.
        IF NOT COALESCE(v_pay.closed_manually, false) AND COALESCE(v_pay.amount_paid, 0) = 0 THEN
          UPDATE public.payables SET closed_manually = true,
            manual_close_reason = 'Compensata nell''effetto RiBa del ' || to_char(v_line.raw_due_date, 'DD/MM/YYYY')
              || ' (addebito MPS del ' || to_char(v_bt.transaction_date, 'DD/MM/YYYY') || ')',
            updated_at = now()
          WHERE id = v_pay.id;
        END IF;
        CONTINUE;
      END IF;
      IF v_first IS NULL THEN v_first := v_pay.id; END IF;
      IF v_pay.status = 'pagato' THEN
        UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      ELSE
        UPDATE public.payables SET
          amount_paid = GREATEST(COALESCE(amount_paid, 0), gross_amount),
          payment_date = v_line.raw_due_date,
          bank_transaction_id = p_bt_id, updated_at = now()
        WHERE id = v_pay.id;
      END IF;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 95, 'applied', v_pay.gross_amount, v_note);
      v_linked := v_linked + 1;
    END LOOP;
    UPDATE public.riba_distinta_lines SET match_status = 'confirmed' WHERE id = v_line.id AND match_status = 'matched';
  END LOOP;

  IF v_linked = 0 THEN
    RAISE EXCEPTION 'effetti ritirati %: combinazione trovata ma nessuna rata da agganciare', p_bt_id;
  END IF;
  UPDATE public.reconciliation_log SET status = 'rejected',
    notes = COALESCE(notes, '') || ' | archiviata: addebito degli effetti ritirati (363)'
  WHERE bank_transaction_id = p_bt_id AND status = 'to_confirm';
  UPDATE public.bank_transactions SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('matched', true, 'auto', true, 'grouped', true, 'effetti', v_n,
                            'linked', v_linked, 'movimento', v_mov);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Addebiti diretti di più fatture dello stesso fornitore
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_match_sdd_sum_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD; v_mov numeric; v_descr text; v_sets int := 0; v_ids uuid[];
  v_sup RECORD; v_cnt int; v_set_ids uuid[];
  v_first uuid := NULL; v_linked int := 0; v_pay RECORD; v_applied numeric; v_supplier text;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing');
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;
  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));
  IF v_descr !~ '(addebito diretto|addebito sdd|(^|[^a-z])sdd([^a-z]|$)|(^|[^a-z])rid([^a-z]|$))' THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_direct_debit');
  END IF;
  v_mov := abs(v_bt.amount);

  -- Scadenze ad addebito diretto, aperte o chiuse in via provvisoria, di fornitori
  -- confermati nella causale, con scadenza da 45 giorni prima a 10 giorni dopo.
  CREATE TEMP TABLE IF NOT EXISTS _sdd_cand (supplier_id uuid, k int, id uuid, amt numeric) ON COMMIT DROP;
  TRUNCATE _sdd_cand;
  INSERT INTO _sdd_cand (supplier_id, k, id, amt)
  SELECT q.supplier_id, row_number() OVER (PARTITION BY q.supplier_id ORDER BY q.due_date, q.id), q.id, q.amt
  FROM (
    SELECT py.supplier_id, py.id, py.due_date,
      CASE WHEN py.status = 'pagato' THEN py.gross_amount
           ELSE COALESCE(py.amount_remaining, py.gross_amount - COALESCE(py.amount_paid, 0)) END AS amt
    FROM public.payables py
    WHERE py.company_id = v_bt.company_id
      AND py.supplier_id IS NOT NULL
      AND py.bank_transaction_id IS NULL
      AND py.gross_amount > 0
      AND NOT COALESCE(py.is_placeholder, false)
      AND (py.status IN ('da_pagare', 'in_scadenza', 'scaduto')
           OR (py.status = 'pagato' AND COALESCE(py.is_provisional_paid, false)))
      AND (py.payment_method::text IN ('sdd_core', 'sdd_b2b', 'rid') OR COALESCE(py.is_auto_debit, false))
      AND COALESCE(py.payment_method::text, '') NOT IN ('carta_credito', 'carta_debito', 'contanti')
      AND py.due_date BETWEEN v_bt.transaction_date - 45 AND v_bt.transaction_date + 10
      AND public.supplier_confirmed_in_text(py.supplier_name, py.supplier_vat, v_descr)
  ) q WHERE q.amt > 0;

  -- Una sola combinazione in tutto, fra tutti i fornitori candidati.
  FOR v_sup IN SELECT supplier_id, count(*) AS n FROM _sdd_cand GROUP BY supplier_id LOOP
    -- Troppe scadenze per provarle tutte: non si può dire che la combinazione sia
    -- una sola, quindi non si aggancia niente (come gli effetti oltre 16).
    IF v_sup.n > 14 THEN
      RETURN jsonb_build_object('matched', false, 'reason', 'too_many_candidates', 'candidates', v_sup.n);
    END IF;
    v_cnt := 0; v_set_ids := NULL;
    WITH RECURSIVE combo AS (
      SELECT c.k, ARRAY[c.id] AS ids, c.amt AS tot FROM _sdd_cand c WHERE c.supplier_id = v_sup.supplier_id
      UNION ALL
      SELECT c.k, combo.ids || c.id, combo.tot + c.amt
      FROM combo JOIN _sdd_cand c ON c.supplier_id = v_sup.supplier_id AND c.k > combo.k
      WHERE combo.tot + c.amt <= v_mov + 0.01
    )
    SELECT z.ids, count(*) OVER () INTO v_set_ids, v_cnt
    FROM (SELECT ids FROM combo WHERE abs(tot - v_mov) <= 0.01 LIMIT 2) z LIMIT 1;
    v_cnt := COALESCE(v_cnt, 0);
    v_sets := v_sets + v_cnt;
    IF v_cnt = 1 THEN v_ids := v_set_ids; END IF;
    EXIT WHEN v_sets > 1;
  END LOOP;

  IF v_sets <> 1 OR v_ids IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'reason',
      CASE WHEN v_sets = 0 THEN 'no_combination' ELSE 'ambiguous' END);
  END IF;

  FOR v_pay IN SELECT * FROM public.payables WHERE id = ANY (v_ids) ORDER BY due_date, id LOOP
    IF v_first IS NULL THEN v_first := v_pay.id; v_supplier := v_pay.supplier_name; END IF;
    IF v_pay.status = 'pagato' THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      v_applied := v_pay.gross_amount;
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0));
      UPDATE public.payables SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
        payment_date = v_bt.transaction_date, bank_transaction_id = p_bt_id, updated_at = now()
      WHERE id = v_pay.id;
    END IF;
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
    VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 95, 'applied', v_applied,
            'auto (addebito diretto cumulativo): fornitore confermato in causale, somma delle scadenze al centesimo');
    v_linked := v_linked + 1;
  END LOOP;

  IF v_linked = 0 THEN
    RAISE EXCEPTION 'addebito diretto %: combinazione trovata ma nessuna rata da agganciare', p_bt_id;
  END IF;
  UPDATE public.reconciliation_log SET status = 'rejected',
    notes = COALESCE(notes, '') || ' | archiviata: addebito diretto cumulativo (363)'
  WHERE bank_transaction_id = p_bt_id AND status = 'to_confirm';
  UPDATE public.bank_transactions SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('matched', true, 'auto', true, 'grouped', (v_linked > 1), 'linked', v_linked,
                            'supplier', v_supplier, 'movimento', v_mov);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Passata sui movimenti non riconciliati
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rerun_cumulative_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE r RECORD; v_proc int := 0; v_eff int := 0; v_sdd int := 0; v_linked int := 0; v_err int := 0; v_res jsonb;
BEGIN
  FOR r IN SELECT id FROM public.bank_transactions
           WHERE amount < 0 AND status IN ('posted', 'booked') AND COALESCE(is_reconciled, false) = false
             AND transaction_date >= current_date - 180
           ORDER BY transaction_date, id LOOP
    v_proc := v_proc + 1;
    -- Ogni movimento nel suo blocco: un errore annulla solo quel movimento e il
    -- giro notturno continua.
    BEGIN
      v_res := public.try_match_effetti_ritirati_bank_transaction(r.id);
      IF COALESCE((v_res->>'matched')::boolean, false) THEN
        v_eff := v_eff + 1; v_linked := v_linked + COALESCE((v_res->>'linked')::int, 0);
        CONTINUE;
      END IF;
      v_res := public.try_match_sdd_sum_bank_transaction(r.id);
      IF COALESCE((v_res->>'matched')::boolean, false) THEN
        v_sdd := v_sdd + 1; v_linked := v_linked + COALESCE((v_res->>'linked')::int, 0);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := v_err + 1;
      RAISE WARNING 'rerun_cumulative_reconciliation %: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('processed', v_proc, 'effetti_ritirati', v_eff, 'addebiti_diretti', v_sdd,
                            'rate_agganciate', v_linked, 'errori', v_err);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Nel giro notturno, dopo i raggruppati e prima delle chiusure provvisorie.
--    Resta la guardia della 364 (richiedi_profilo_gestionale) subito dopo il BEGIN.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_disp jsonb; v_group jsonb; v_cum jsonb; v_bij jsonb; v_amt jsonb; v_close jsonb;
  v_util jsonb; v_riba jsonb; v_cash jsonb; v_fisc jsonb; v_cat jsonb;
  v_t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM public.richiedi_profilo_gestionale(); -- migration 364
  SET LOCAL statement_timeout = '20min';

  v_disp := public.rerun_distinta_reconciliation();
  v_group := public.rerun_group_reconciliation();
  v_cum := public.rerun_cumulative_reconciliation();
  v_bij := public.rerun_bijective_reconciliation();
  v_amt := public.rerun_amount_reconciliation();
  v_close := public.close_non_supplier_movements();
  v_util := public.close_utility_movements();
  v_riba := public.rerun_riba_provisional_close();
  v_cash := public.rerun_cash_card_provisional_close();
  v_fisc := public.close_paid_fiscal_deadlines();
  v_cat := public.clean_bank_category_conflicts();

  RETURN jsonb_build_object('distinte', v_disp, 'granitici', v_group, 'cumulativi', v_cum,
                            'biettivo', v_bij,
                            'importo_anonimo', v_amt, 'chiusi_non_fornitore', v_close,
                            'chiusi_utenze', v_util, 'riba_provvisorie', v_riba,
                            'contanti_carte_provvisorie', v_cash,
                            'scadenze_fiscali', v_fisc, 'etichette', v_cat,
                            'run_at', now(),
                            'durata_sec', round(extract(epoch from (clock_timestamp() - v_t0))::numeric, 1));
END;
$function$;

-- Funzioni interne del motore: non si chiamano dal browser.
REVOKE ALL ON FUNCTION public.try_match_effetti_ritirati_bank_transaction(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.try_match_sdd_sum_bank_transaction(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rerun_cumulative_reconciliation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_match_effetti_ritirati_bank_transaction(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.try_match_sdd_sum_bank_transaction(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rerun_cumulative_reconciliation() TO service_role;

COMMIT;
