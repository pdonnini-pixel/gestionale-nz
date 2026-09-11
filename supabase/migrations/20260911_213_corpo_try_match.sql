-- 20260911_213 (corpo) — try_match_bank_transaction con le tre guardie.
-- Estratto dal DB dopo l'applicazione, per avere il testo esatto versionato.
-- Le aggiunte rispetto alla v5 sono tre, tutte prima dell'INSERT della proposta:
--   · fn_bank_own_movement  -> movimento della banca, nessuna proposta;
--   · status 'rejected'     -> coppia gia' rifiutata, non si insiste;
--   · status 'to_confirm'   -> coppia gia' proposta, niente copie.
-- Punteggi e soglie invariati. Applicata su NZ, Made e Zago, md5 identico:
--   8778a9491a548e96581a3183a9e7cdf7

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
  v_best_due_date DATE;
  v_best_installment INTEGER;
  v_best_invoice TEXT;
  v_best_supplier_key TEXT;
  v_best_gap INTEGER;
  v_gap INTEGER;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'amount_not_negative_or_tx_not_found');
  END IF;

  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_reconciled');
  END IF;

  -- Roba della banca o giro interno (rata di mutuo, canone del rapporto, prelievo,
  -- giroconto, commissioni POS, addebito dell'estratto carte): nessuna fattura dietro,
  -- quindi nessuna proposta. Stessa lista del frontend (BANK_OWN_MOVEMENT_RE).
  IF public.fn_bank_own_movement(v_bt.description) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'movimento_della_banca');
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
      AND (payables.invoice_date IS NULL OR payables.invoice_date <= v_bt.transaction_date)
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = payables.id AND l.status = 'pending'
      )
  LOOP
    v_pay_is_closed := COALESCE(v_pay.is_closed_manual, false);

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

    v_disp_hit := public.payable_in_distinta_for_movement(v_pay.id, v_bt.bank_account_id, v_bt.transaction_date);
    v_score_disp := CASE WHEN v_disp_hit THEN 25 ELSE 0 END;

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

    IF v_pay_is_closed AND (NOT v_identity OR v_amount_diff_pct > 5) THEN
      CONTINUE;
    END IF;

    v_score_total := v_score_amount + v_score_name + v_score_date + v_bank_bonus + v_score_invoice + v_score_disp;
    v_gap := CASE WHEN v_pay.due_date IS NULL THEN NULL ELSE abs(v_bt.transaction_date - v_pay.due_date) END;

    IF v_score_total > v_best_score THEN
      v_best_score := v_score_total;
      v_best_payable_id := v_pay.id;
      v_best_amount := v_score_amount;
      v_best_name := v_score_name;
      v_best_date := v_score_date;
      v_best_is_closed := v_pay_is_closed;
      v_best_identity := v_identity;
      v_best_due_date := v_pay.due_date;
      v_best_installment := v_pay.installment_number;
      v_best_invoice := v_pay.invoice_number;
      v_best_supplier_key := COALESCE(v_pay.supplier_vat, v_pay.supplier_id::text, v_pay.supplier_name);
      v_best_gap := v_gap;
      v_ties := 1;
    ELSIF v_score_total = v_best_score AND v_score_total > 0 THEN
      IF v_pay.invoice_number IS NOT NULL
         AND v_pay.invoice_number = v_best_invoice
         AND COALESCE(v_pay.supplier_vat, v_pay.supplier_id::text, v_pay.supplier_name) IS NOT DISTINCT FROM v_best_supplier_key THEN
        IF (v_gap IS NOT NULL AND (v_best_gap IS NULL OR v_gap < v_best_gap))
           OR (v_gap IS NOT DISTINCT FROM v_best_gap
               AND COALESCE(v_pay.installment_number, 0) < COALESCE(v_best_installment, 0)) THEN
          v_best_payable_id := v_pay.id;
          v_best_amount := v_score_amount;
          v_best_name := v_score_name;
          v_best_date := v_score_date;
          v_best_is_closed := v_pay_is_closed;
          v_best_identity := v_identity;
          v_best_due_date := v_pay.due_date;
          v_best_installment := v_pay.installment_number;
          v_best_gap := v_gap;
        END IF;
      ELSE
        v_ties := v_ties + 1;
      END IF;
    END IF;
  END LOOP;

  IF v_best_payable_id IS NULL OR v_best_score < 50 THEN
    RETURN jsonb_build_object('matched', false, 'best_score', v_best_score);
  END IF;

  -- Il no di una persona vale piu' del punteggio: coppia gia' rifiutata, non si insiste.
  IF EXISTS (
    SELECT 1 FROM public.reconciliation_log l
    WHERE l.bank_transaction_id = p_bt_id AND l.payable_id = v_best_payable_id
      AND l.status = 'rejected'
  ) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'gia_rifiutata');
  END IF;

  -- Niente copie doppie della stessa proposta.
  IF EXISTS (
    SELECT 1 FROM public.reconciliation_log l
    WHERE l.bank_transaction_id = p_bt_id AND l.payable_id = v_best_payable_id
      AND l.status = 'to_confirm'
  ) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'gia_proposta');
  END IF;

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
    v_bt.company_id, p_bt_id, v_best_payable_id, v_match_type, LEAST(100, v_best_score),
    v_best_amount, v_best_name, v_best_date, v_log_status,
    CASE
      WHEN v_best_is_closed THEN 'auto-generated: fattura gia'' pagata — conferma aggancio movimento'
      WHEN NOT v_best_identity THEN 'auto-generated: solo importo/data/banca, beneficiario non confermato — serve conferma'
      WHEN v_ties > 1 THEN 'auto-generated: ' || v_ties || ' scadenze a pari punteggio, il motore non puo'' scegliere — serve conferma'
      ELSE 'auto-generated by try_match_bank_transaction v5'
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
    'score', LEAST(100, v_best_score),
    'match_type', v_match_type,
    'closed_manual', v_best_is_closed,
    'identity', v_best_identity,
    'applied', v_match_type = 'auto_exact'
  );
END;
$function$
;
