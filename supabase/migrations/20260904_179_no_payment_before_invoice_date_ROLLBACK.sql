-- =============================================================================
-- ROLLBACK migrazione 179 — rimette la guardia com'era prima del 04/09/2026
-- =============================================================================
-- Ripristina:
--   * try_match_amount_bank_transaction v3 (migration 164, finestra -120 / +180 gg)
--   * try_match_bank_transaction v4        (migration 164, pool senza guardia)
--   * rerun_bijective_reconciliation       (migration 117, tolleranza -15 giorni)
--
-- Da usare solo se la guardia secca "movimento >= data fattura" lascia scoperti
-- pagamenti reali che prima si agganciavano da soli. ⚠️ NZ + Made + Zago.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.try_match_amount_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD;
  v_descr TEXT;
  v_net NUMERIC := NULL;
  v_named BOOLEAN := false;
  v_n INT := 0;
  v_n_disp INT := 0;
  v_ids uuid[];
  v_disp_id uuid;
  v_only RECORD;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing');
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;

  v_descr := coalesce(v_bt.description, '');
  v_net := public.bank_movement_net(v_descr);
  IF v_net IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'no_structured_net');
  END IF;

  v_named := public.causale_has_named_beneficiary(v_descr);

  WITH cand AS (
    SELECT p.id,
           public.payable_in_distinta_for_movement(p.id, v_bt.bank_account_id, v_bt.transaction_date) AS in_disp
    FROM public.payables p
    WHERE p.company_id = v_bt.company_id
      AND p.bank_transaction_id IS NULL
      AND p.gross_amount > 0
      AND COALESCE(p.is_placeholder, false) = false
      AND ( p.status IN ('da_pagare', 'in_scadenza', 'scaduto')
            OR (p.status = 'pagato' AND COALESCE(p.closed_manually, false)) )
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = p.id AND l.status = 'pending')
      AND abs(p.gross_amount - v_net) <= 0.02
      AND ( NOT v_named
            OR public.supplier_confirmed_in_text(p.supplier_name, p.supplier_vat, v_descr) )
      AND v_bt.transaction_date
            BETWEEN COALESCE(p.invoice_date, p.due_date, v_bt.transaction_date) - INTERVAL '120 days'
                AND COALESCE(p.due_date, p.invoice_date, v_bt.transaction_date) + INTERVAL '180 days'
  )
  SELECT count(*), count(*) FILTER (WHERE in_disp),
         array_agg(id), (array_agg(id) FILTER (WHERE in_disp))[1]
    INTO v_n, v_n_disp, v_ids, v_disp_id
  FROM cand;

  IF v_n = 0 THEN
    RETURN jsonb_build_object('matched', false);
  END IF;

  -- Piu' candidati a pari importo: la distinta decide, se ne indica uno solo.
  IF v_n = 1 THEN
    SELECT * INTO v_only FROM public.payables WHERE id = v_ids[1];
  ELSIF v_n_disp = 1 THEN
    SELECT * INTO v_only FROM public.payables WHERE id = v_disp_id;
  ELSE
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
    SELECT v_bt.company_id, p_bt_id, p.id, 'auto_fuzzy', 60, 'to_confirm', p.gross_amount,
           'proposta: IMPORTO BONIFICI netto esatto (flusso CBI anonimo) — piu'' candidati, conferma manuale'
    FROM public.payables p WHERE p.id = ANY(v_ids);
    RETURN jsonb_build_object('matched', false, 'proposed', v_n, 'reason', 'ambiguous_proposed');
  END IF;

  IF v_only.status = 'pagato' AND COALESCE(v_only.closed_manually, false) THEN
    UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_only.id;
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
    VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 95, 'applied', v_only.gross_amount,
            'auto: IMPORTO BONIFICI netto esatto e univoco (flusso CBI anonimo) — chiusa a mano, solo aggancio');
  ELSE
    UPDATE public.payables
    SET amount_paid = v_only.gross_amount,
        amount_remaining = 0,
        status = 'pagato'::payable_status,
        payment_date = v_bt.transaction_date,
        bank_transaction_id = p_bt_id,
        updated_at = now()
    WHERE id = v_only.id;
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
    VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 90, 'applied', v_only.gross_amount,
            'auto: IMPORTO BONIFICI netto esatto e univoco (flusso CBI anonimo)');
  END IF;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_only.id
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('matched', true, 'auto', true, 'payable_id', v_only.id, 'net', v_net,
                            'disambiguated_by_distinta', (v_n > 1));
END;
$function$;

CREATE OR REPLACE FUNCTION public.try_match_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD;
  v_pay RECORD;
  v_best_payable_id UUID;
  v_best_score NUMERIC := 0;
  v_best_amount NUMERIC := 0;
  v_best_name NUMERIC := 0;
  v_best_date NUMERIC := 0;
  v_best_is_closed BOOLEAN := false;
  v_best_identity BOOLEAN := false;
  v_pay_is_closed BOOLEAN;
  v_score_amount NUMERIC;
  v_score_name NUMERIC;
  v_score_date NUMERIC;
  v_score_invoice NUMERIC;
  v_score_disp NUMERIC;
  v_score_total NUMERIC;
  v_bank_bonus NUMERIC;
  v_amount_diff_pct NUMERIC;
  v_days_diff INTEGER;
  v_match_type TEXT;
  v_log_status TEXT;
  v_descr TEXT;
  v_name_in_descr BOOLEAN;
  v_inv_hit BOOLEAN;
  v_disp_hit BOOLEAN;
  v_identity BOOLEAN;
  v_mov NUMERIC;
  v_net NUMERIC;
  v_cmp NUMERIC;
  v_key_len INTEGER;
  v_ties INTEGER := 0;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'amount_not_negative_or_tx_not_found');
  END IF;

  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_reconciled');
  END IF;

  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));
  v_mov := abs(v_bt.amount);
  v_net := public.bank_movement_net(v_bt.description);

  FOR v_pay IN
    SELECT *,
           (status = 'pagato') AS is_closed_manual
    FROM public.payables
    WHERE company_id = v_bt.company_id
      AND bank_transaction_id IS NULL
      AND gross_amount > 0
      AND status IN ('da_pagare', 'in_scadenza', 'scaduto', 'pagato')
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = payables.id AND l.status = 'pending'
      )
  LOOP
    v_pay_is_closed := COALESCE(v_pay.is_closed_manual, false);

    -- Importo da confrontare. Tre letture, in ordine di precisione:
    --  1) la quota bonifici del flusso CBI, quando la causale la espone;
    --  2) il movimento al netto delle spese bancarie (tolleranza ASIMMETRICA: la
    --     banca puo' addebitare piu' della fattura, mai meno);
    --  3) il movimento cosi' com'e'.
    v_cmp := v_mov;
    IF v_net IS NOT NULL AND abs(v_net - v_pay.gross_amount) <= 0.02 THEN
      v_cmp := v_pay.gross_amount;
    ELSIF v_mov > v_pay.gross_amount
          AND (v_mov - v_pay.gross_amount) <= LEAST(5.00, GREATEST(0.50, v_pay.gross_amount * 0.002)) THEN
      v_cmp := v_pay.gross_amount;
    END IF;

    v_amount_diff_pct := abs(v_cmp - v_pay.gross_amount) / v_pay.gross_amount * 100;
    v_score_amount := GREATEST(0, 50 - v_amount_diff_pct * 5);

    v_score_name := 0;
    v_name_in_descr := false;
    IF v_pay.supplier_vat IS NOT NULL AND v_descr LIKE '%' || lower(v_pay.supplier_vat) || '%' THEN
      v_score_name := 30;
      v_name_in_descr := true;
    ELSIF v_pay.supplier_name IS NOT NULL AND v_descr LIKE '%' || lower(v_pay.supplier_name) || '%' THEN
      v_score_name := 25;
      v_name_in_descr := true;
    ELSIF v_pay.supplier_name IS NOT NULL THEN
      v_score_name := similarity(v_descr, lower(v_pay.supplier_name)) * 30;
      IF public.supplier_confirmed_in_text(v_pay.supplier_name, v_pay.supplier_vat, v_descr) THEN
        v_name_in_descr := true;
      END IF;
    END IF;

    IF v_pay.due_date IS NULL THEN
      v_score_date := 0;
    ELSE
      v_days_diff := abs(v_bt.transaction_date - v_pay.due_date);
      v_score_date := GREATEST(0, 20 - v_days_diff);
    END IF;

    v_bank_bonus := 0;
    IF v_pay.payment_bank_account_id IS NOT NULL
       AND v_pay.payment_bank_account_id = v_bt.bank_account_id THEN
      v_bank_bonus := 10;
    END IF;

    -- La distinta come conferma di identita': una persona ha detto che questa
    -- scadenza andava pagata da questa banca in questi giorni.
    v_disp_hit := public.payable_in_distinta_for_movement(v_pay.id, v_bt.bank_account_id, v_bt.transaction_date);
    v_score_disp := CASE WHEN v_disp_hit THEN 25 ELSE 0 END;

    -- Numero fattura: chiavi normalizzate v3. La soglia di lunghezza tiene fuori i
    -- falsi positivi: due o tre cifre isolate compaiono ovunque in una causale.
    v_score_invoice := 0;
    v_inv_hit := false;
    SELECT max(length(k)) INTO v_key_len
    FROM unnest(public.invoice_number_keys(v_pay.invoice_number)) k
    WHERE length(k) >= 2
      AND v_descr ~ ('(^|[^0-9])' || k || '([^0-9]|$)');

    IF v_key_len IS NOT NULL THEN
      IF v_key_len >= 5 THEN
        v_inv_hit := true;
        v_score_invoice := CASE WHEN v_amount_diff_pct <= 2 THEN 45 ELSE 15 END;
      ELSIF v_key_len >= 3 AND v_amount_diff_pct <= 2 AND (v_name_in_descr OR v_disp_hit) THEN
        v_inv_hit := true;
        v_score_invoice := 45;
      ELSIF v_amount_diff_pct <= 2 AND v_name_in_descr THEN
        v_inv_hit := true;
        v_score_invoice := 45;
      END IF;
    END IF;

    v_identity := v_name_in_descr OR v_inv_hit OR v_disp_hit;

    -- Gate per le fatture GIA' PAGATE: mai solo-importo, e scarto entro il 5%.
    IF v_pay_is_closed AND (NOT v_identity OR v_amount_diff_pct > 5) THEN
      CONTINUE;
    END IF;

    v_score_total := LEAST(100, v_score_amount + v_score_name + v_score_date + v_bank_bonus + v_score_invoice + v_score_disp);

    IF v_score_total > v_best_score THEN
      v_best_score := v_score_total;
      v_best_payable_id := v_pay.id;
      v_best_amount := v_score_amount;
      v_best_name := v_score_name;
      v_best_date := v_score_date;
      v_best_is_closed := v_pay_is_closed;
      v_best_identity := v_identity;
      v_ties := 1;
    ELSIF v_score_total = v_best_score AND v_score_total > 0 THEN
      -- Pari merito: due scadenze indistinguibili per il motore. Vedi sotto.
      v_ties := v_ties + 1;
    END IF;
  END LOOP;

  IF v_best_payable_id IS NULL OR v_best_score < 50 THEN
    RETURN jsonb_build_object('matched', false, 'best_score', v_best_score);
  END IF;

  -- GATE DI IDENTITA' (novita' v3, la piu' importante).
  -- Un punteggio alto costruito solo su importo, data e banca non basta a chiudere
  -- niente: su un fornitore con fatture tutte uguali aggancia la fattura sbagliata e
  -- lo scramble si propaga a catena (caso SPM Investigazioni, PAYMENT_PLAN_NOTES.md).
  -- Serve sempre almeno una conferma di CHI e' il beneficiario: fornitore in causale,
  -- numero fattura, oppure la distinta. Senza, si propone e decide una persona.
  --
  -- Seconda guardia: PARI MERITO. Se due scadenze arrivano allo stesso punteggio
  -- massimo il motore non ha modo di distinguerle, e sceglierne una e' tirare a
  -- indovinare su un dato contabile. Si propone e basta.
  IF v_best_score >= 80 AND NOT v_best_is_closed AND v_best_identity AND v_ties = 1 THEN
    v_match_type := 'auto_exact';
    v_log_status := 'applied';
  ELSE
    v_match_type := 'auto_fuzzy';
    v_log_status := 'to_confirm';
  END IF;

  INSERT INTO public.reconciliation_log (
    company_id, bank_transaction_id, payable_id, match_type, confidence,
    score_amount, score_name, score_date, status, notes
  ) VALUES (
    v_bt.company_id, p_bt_id, v_best_payable_id, v_match_type, v_best_score,
    v_best_amount, v_best_name, v_best_date, v_log_status,
    CASE
      WHEN v_best_is_closed THEN 'auto-generated: fattura gia'' pagata — conferma aggancio movimento'
      WHEN NOT v_best_identity THEN 'auto-generated: solo importo/data/banca, beneficiario non confermato — serve conferma'
      WHEN v_ties > 1 THEN 'auto-generated: ' || v_ties || ' scadenze a pari punteggio, il motore non puo'' scegliere — serve conferma'
      ELSE 'auto-generated by try_match_bank_transaction v3'
    END
  );

  IF v_match_type = 'auto_exact' THEN
    UPDATE public.payables
    SET bank_transaction_id = p_bt_id,
        status = 'pagato'::payable_status,
        amount_paid = gross_amount,
        amount_remaining = 0,
        payment_date = v_bt.transaction_date,
        updated_at = now()
    WHERE id = v_best_payable_id;

    UPDATE public.bank_transactions
    SET is_reconciled = true,
        reconciled_at = now(),
        reconciled_invoice_id = v_best_payable_id
    WHERE id = p_bt_id;
  END IF;

  RETURN jsonb_build_object(
    'matched', true,
    'payable_id', v_best_payable_id,
    'score', v_best_score,
    'match_type', v_match_type,
    'closed_manual', v_best_is_closed,
    'identity', v_best_identity,
    'applied', v_match_type = 'auto_exact'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rerun_bijective_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pay RECORD;
  v_bt RECORD;
  v_applied NUMERIC;
  v_pairs INT := 0;
  v_inv_date DATE;
BEGIN
  FOR v_pay IN
    SELECT * FROM public.payables
    WHERE bank_transaction_id IS NULL
      AND gross_amount > 0
      AND supplier_name IS NOT NULL
      AND status IN ('da_pagare', 'in_scadenza', 'scaduto', 'pagato')
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = payables.id AND l.status = 'pending')
    ORDER BY company_id, supplier_name, gross_amount,
             COALESCE(invoice_date, due_date, created_at::date)
  LOOP
    v_inv_date := COALESCE(v_pay.invoice_date, v_pay.due_date, v_pay.created_at::date);

    SELECT bt.* INTO v_bt
    FROM public.bank_transactions bt
    WHERE bt.company_id = v_pay.company_id
      AND bt.amount < 0
      AND COALESCE(bt.is_reconciled, false) = false
      AND bt.status IN ('posted', 'booked')
      AND abs(abs(bt.amount) - v_pay.gross_amount) <= GREATEST(0.02, v_pay.gross_amount * 0.01)
      -- GAP #2: non si paga prima che la fattura esista (tolleranza 15 gg per anticipi/lag).
      AND bt.transaction_date >= v_inv_date - INTERVAL '15 days'
      AND public.supplier_confirmed_in_text(
            v_pay.supplier_name, v_pay.supplier_vat,
            coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '') || ' ' || coalesce(bt.merchant_name, ''))
    ORDER BY abs(bt.transaction_date - v_inv_date) ASC, bt.transaction_date DESC
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_pay.status = 'pagato' THEN
      UPDATE public.payables SET bank_transaction_id = v_bt.id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_pay.company_id, v_bt.id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount,
              'auto: abbinamento per data — stesso fornitore/importo (già pagata)');
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables
      SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
          payment_date = v_bt.transaction_date,
          bank_transaction_id = v_bt.id,
          updated_at = now()
      WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_pay.company_id, v_bt.id, v_pay.id, 'auto_exact', 100, 'applied', v_applied,
              'auto: abbinamento per data — stesso fornitore/importo');
    END IF;

    UPDATE public.bank_transactions
    SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_pay.id
    WHERE id = v_bt.id;

    v_pairs := v_pairs + 1;
  END LOOP;

  RETURN jsonb_build_object('coppie_abbinate', v_pairs);
END;
$function$;

COMMIT;
