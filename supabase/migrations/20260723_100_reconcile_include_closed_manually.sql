-- =====================================================================
-- Migrazione 100 — Riconciliazione: verifica SEMPRE anche le fatture
--                  chiuse a mano (regola operativa di Patrizio)
-- =====================================================================
-- REGOLA (Patrizio, 2026-07-23): "ogni qualvolta arriva un movimento — storico
-- o nuovo — devi SEMPRE verificare se sia già presente tra le fatture chiuse a
-- mano; quindi ogni fattura non chiusa da un movimento va sempre verificata".
--
-- PROBLEMA: il motore (try_match_bank_transaction) considerava SOLO le fatture
-- ancora aperte (da_pagare / in_scadenza / scaduto). Le fatture chiuse a mano
-- dalla contabile (status='pagato', closed_manually=true) con bank_transaction_id
-- NULL erano INVISIBILI al motore: il movimento bancario restava orfano e la
-- fattura risultava "già chiusa", senza che i due lati venissero mai uniti.
-- (Casi reali: SFORAZZINI, CLIMASERVICE, e ~190 fatture totali.)
--
-- FIX: il candidato ora include ANCHE le fatture chiuse a mano non ancora
-- agganciate a un movimento. Per queste:
--   • serve una corroborazione forte (nome/P.IVA in causale OPPURE numero
--     fattura come token isolato) + importo coerente (<= 5%): mai solo-importo,
--     per evitare i falsi positivi da coincidenza di importo;
--   • NON si chiude mai in automatico: si genera SEMPRE un suggerimento
--     'to_confirm' che la contabile conferma una per una. L'aggancio effettivo
--     passa da reconcile_movement (ramo "fattura chiusa a mano": nessuna doppia
--     scrittura, la fattura resta pagata, si collega solo il movimento).
--
-- Le fatture aperte mantengono il comportamento identico (092/093), incluso
-- l'auto_exact >= 80. Aggiunta anche una guardia: i movimenti già riconciliati
-- (is_reconciled) non generano più suggerimenti.
--
-- Additiva/idempotente (CREATE OR REPLACE). NON distruttiva.
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago.
-- Dopo l'applicazione, per rigenerare i suggerimenti sullo STORICO:
--     SELECT public.rerun_reconciliation();
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
  v_best_is_closed BOOLEAN := false;
  v_pay_is_closed BOOLEAN;
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
  v_inv_hit BOOLEAN;
  v_inv_norm TEXT;
  v_inv_re TEXT;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'amount_not_negative_or_tx_not_found');
  END IF;

  -- Un movimento già riconciliato non deve generare nuovi suggerimenti.
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_reconciled');
  END IF;

  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));

  FOR v_pay IN
    SELECT *,
           (status = 'pagato' AND COALESCE(closed_manually, false) = true) AS is_closed_manual
    FROM public.payables
    WHERE company_id = v_bt.company_id
      AND bank_transaction_id IS NULL
      AND gross_amount > 0
      AND (
        status IN ('da_pagare', 'in_scadenza', 'scaduto')
        OR (status = 'pagato' AND COALESCE(closed_manually, false) = true)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = payables.id AND l.status = 'pending'
      )
  LOOP
    v_pay_is_closed := COALESCE(v_pay.is_closed_manual, false);

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
    v_inv_hit := false;
    v_inv_norm := regexp_replace(lower(coalesce(v_pay.invoice_number, '')), '[^a-z0-9]', '', 'g');
    IF length(v_inv_norm) >= 2 THEN
      v_inv_re := '(^|[^a-z0-9])'
                  || regexp_replace(lower(trim(v_pay.invoice_number)), '[^a-z0-9]+', '[^a-z0-9]{0,3}', 'g')
                  || '([^a-z0-9]|$)';
      IF v_descr ~ v_inv_re THEN
        IF length(v_inv_norm) >= 5 THEN
          v_inv_hit := true;
          v_score_invoice := CASE WHEN v_amount_diff_pct <= 2 THEN 45 ELSE 15 END;
        ELSIF v_amount_diff_pct <= 2 AND v_name_in_descr THEN
          v_inv_hit := true;
          v_score_invoice := 45;
        END IF;
      END IF;
    END IF;

    -- Gate per le fatture CHIUSE A MANO: mai solo-importo. Serve nome/P.IVA in
    -- causale OPPURE numero fattura, e importo coerente (<= 5%). Altrimenti si
    -- scarta il candidato chiuso (evita falsi positivi da coincidenza importo).
    IF v_pay_is_closed AND (NOT (v_name_in_descr OR v_inv_hit) OR v_amount_diff_pct > 5) THEN
      CONTINUE;
    END IF;

    v_score_total := LEAST(100, v_score_amount + v_score_name + v_score_date + v_bank_bonus + v_score_invoice);

    IF v_score_total > v_best_score THEN
      v_best_score := v_score_total;
      v_best_payable_id := v_pay.id;
      v_best_amount := v_score_amount;
      v_best_name := v_score_name;
      v_best_date := v_score_date;
      v_best_is_closed := v_pay_is_closed;
    END IF;
  END LOOP;

  IF v_best_payable_id IS NULL OR v_best_score < 50 THEN
    RETURN jsonb_build_object('matched', false, 'best_score', v_best_score);
  END IF;

  -- Auto_exact SOLO per le fatture aperte: una fattura già chiusa a mano non si
  -- tocca mai in automatico, si propone solo l'aggancio del movimento.
  IF v_best_score >= 80 AND NOT v_best_is_closed THEN
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
    CASE WHEN v_best_is_closed
         THEN 'auto-generated: fattura chiusa a mano — conferma aggancio movimento'
         ELSE 'auto-generated by try_match_bank_transaction' END
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
    'applied', v_match_type = 'auto_exact'
  );
END;
$function$;
