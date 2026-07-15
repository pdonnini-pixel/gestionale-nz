-- =====================================================================
-- Migrazione 093 — Riconciliazione: numeri fattura CORTI con "tripla conferma"
-- =====================================================================
-- Estende la 092. Il match per numero fattura ora copre anche i numeri CORTI o
-- alfanumerici corti (2-4 caratteri significativi, es. "48", "26/A", "1/20"),
-- ma SOLO con tripla conferma per non chiudere la fattura sbagliata:
--   1) il numero compare nella causale come TOKEN ISOLATO (non sottostringa: "48"
--      non matcha dentro "1480"), tollerando i separatori (26/A = 26-A = 26 A);
--   2) il fornitore è confermato nella causale (P.IVA, oppure nome, oppure almeno
--      una parola significativa del nome, es. "barberino");
--   3) l'importo coincide (diff <= 2%).
-- I numeri lunghi (>= 5 caratteri) restano come nella 092: bastano numero-in-causale
-- + importo per l'automatico. I numeri di 1 solo carattere restano manuali.
--
-- Il match ora è sempre "a token isolato" (via regex con confini), più preciso della
-- sottostringa usata prima: riduce i falsi positivi anche sui numeri lunghi.
--
-- Additiva/idempotente (CREATE OR REPLACE). ⚠️ REGOLA #0 — applicare su NZ + Made + Zago.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.try_match_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bt RECORD;
  v_pay RECORD;
  v_best_payable_id UUID;
  v_best_score NUMERIC := 0;
  v_best_amount NUMERIC := 0;
  v_best_name NUMERIC := 0;
  v_best_date NUMERIC := 0;
  v_score_amount NUMERIC;
  v_score_name NUMERIC;
  v_score_date NUMERIC;
  v_score_invoice NUMERIC;
  v_score_total NUMERIC;
  v_bank_bonus NUMERIC;
  v_amount_diff_pct NUMERIC;
  v_days_diff INTEGER;
  v_match_type TEXT;
  v_log_status TEXT;
  v_descr TEXT;
  v_name_in_descr BOOLEAN;
  v_inv_norm TEXT;
  v_inv_re TEXT;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'amount_not_negative_or_tx_not_found');
  END IF;

  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));

  FOR v_pay IN
    SELECT * FROM public.payables
    WHERE company_id = v_bt.company_id
      AND status IN ('da_pagare', 'in_scadenza', 'scaduto')
      AND bank_transaction_id IS NULL
      AND gross_amount > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = payables.id AND l.status = 'pending'
      )
  LOOP
    v_amount_diff_pct := abs(abs(v_bt.amount) - v_pay.gross_amount) / v_pay.gross_amount * 100;
    v_score_amount := GREATEST(0, 50 - v_amount_diff_pct * 5);

    -- Nome/P.IVA: punteggio + flag "fornitore presente in causale" (per la tripla conferma)
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
      -- corroborazione: almeno una parola significativa (>=4 char) del nome nella causale
      IF EXISTS (
        SELECT 1 FROM regexp_split_to_table(lower(v_pay.supplier_name), '[^a-z0-9]+') w
        WHERE length(w) >= 4 AND position(w in v_descr) > 0
      ) THEN
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

    -- Asse "numero fattura in causale" (match come TOKEN ISOLATO)
    v_score_invoice := 0;
    v_inv_norm := regexp_replace(lower(coalesce(v_pay.invoice_number, '')), '[^a-z0-9]', '', 'g');
    IF length(v_inv_norm) >= 2 THEN
      -- regex: numero come token, i separatori diventano "0-3 caratteri non alfanumerici"
      v_inv_re := '(^|[^a-z0-9])'
                  || regexp_replace(lower(trim(v_pay.invoice_number)), '[^a-z0-9]+', '[^a-z0-9]{0,3}', 'g')
                  || '([^a-z0-9]|$)';
      IF v_descr ~ v_inv_re THEN
        IF length(v_inv_norm) >= 5 THEN
          -- numero distintivo: da solo (con importo coerente) basta per l'automatico
          v_score_invoice := CASE WHEN v_amount_diff_pct <= 2 THEN 45 ELSE 15 END;
        ELSIF v_amount_diff_pct <= 2 AND v_name_in_descr THEN
          -- numero corto: tripla conferma (numero + fornitore + importo esatto)
          v_score_invoice := 45;
        END IF;
      END IF;
    END IF;

    v_score_total := LEAST(100, v_score_amount + v_score_name + v_score_date + v_bank_bonus + v_score_invoice);

    IF v_score_total > v_best_score THEN
      v_best_score := v_score_total;
      v_best_payable_id := v_pay.id;
      v_best_amount := v_score_amount;
      v_best_name := v_score_name;
      v_best_date := v_score_date;
    END IF;
  END LOOP;

  IF v_best_payable_id IS NULL OR v_best_score < 50 THEN
    RETURN jsonb_build_object('matched', false, 'best_score', v_best_score);
  END IF;

  IF v_best_score >= 80 THEN
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
    'auto-generated by try_match_bank_transaction'
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
    'applied', v_match_type = 'auto_exact'
  );
END;
$function$;
