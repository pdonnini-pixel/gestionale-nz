-- ROLLBACK di 20260903_164_reconcile_engine_v3.sql
-- Ripristina il motore v2. Non tocca i dati: le riconciliazioni gia' applicate
-- restano, e restano annullabili una per una con undo_reconcile_movement.

BEGIN;

-- invoice_number_keys v2 (senza segmenti separati, senza filtro anni)
CREATE OR REPLACE FUNCTION public.invoice_number_keys(p_inv text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
  WITH toks AS (
    SELECT regexp_replace(coalesce(p_inv, ''), '[^0-9]', '', 'g') AS k
    UNION ALL
    SELECT m[1] FROM regexp_matches(coalesce(p_inv, ''), '([0-9]{6,})', 'g') m
  )
  SELECT ARRAY(
    SELECT DISTINCT v FROM (
      SELECT k AS v FROM toks WHERE k <> ''
      UNION ALL
      SELECT ltrim(k, '0') FROM toks WHERE ltrim(k, '0') <> ''
    ) x
  );
$function$;

-- try_match_bank_transaction v2 (senza gate di identita', senza distinta, senza spese)
CREATE OR REPLACE FUNCTION public.try_match_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD; v_pay RECORD; v_best_payable_id UUID; v_best_score NUMERIC := 0;
  v_best_amount NUMERIC := 0; v_best_name NUMERIC := 0; v_best_date NUMERIC := 0;
  v_best_is_closed BOOLEAN := false; v_pay_is_closed BOOLEAN;
  v_score_amount NUMERIC; v_score_name NUMERIC; v_score_date NUMERIC;
  v_score_invoice NUMERIC; v_score_total NUMERIC; v_bank_bonus NUMERIC;
  v_amount_diff_pct NUMERIC; v_days_diff INTEGER; v_match_type TEXT; v_log_status TEXT;
  v_descr TEXT; v_name_in_descr BOOLEAN; v_inv_hit BOOLEAN; v_inv_norm TEXT; v_inv_re TEXT;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'amount_not_negative_or_tx_not_found');
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_reconciled');
  END IF;
  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));
  FOR v_pay IN
    SELECT *, (status = 'pagato') AS is_closed_manual
    FROM public.payables
    WHERE company_id = v_bt.company_id AND bank_transaction_id IS NULL AND gross_amount > 0
      AND status IN ('da_pagare', 'in_scadenza', 'scaduto', 'pagato')
      AND NOT EXISTS (SELECT 1 FROM public.payable_credit_note_links l WHERE l.payable_id = payables.id AND l.status = 'pending')
  LOOP
    v_pay_is_closed := COALESCE(v_pay.is_closed_manual, false);
    v_amount_diff_pct := abs(abs(v_bt.amount) - v_pay.gross_amount) / v_pay.gross_amount * 100;
    v_score_amount := GREATEST(0, 50 - v_amount_diff_pct * 5);
    v_score_name := 0; v_name_in_descr := false;
    IF v_pay.supplier_vat IS NOT NULL AND v_descr LIKE '%' || lower(v_pay.supplier_vat) || '%' THEN
      v_score_name := 30; v_name_in_descr := true;
    ELSIF v_pay.supplier_name IS NOT NULL AND v_descr LIKE '%' || lower(v_pay.supplier_name) || '%' THEN
      v_score_name := 25; v_name_in_descr := true;
    ELSIF v_pay.supplier_name IS NOT NULL THEN
      v_score_name := similarity(v_descr, lower(v_pay.supplier_name)) * 30;
      IF public.supplier_confirmed_in_text(v_pay.supplier_name, v_pay.supplier_vat, v_descr) THEN
        v_name_in_descr := true;
      END IF;
    END IF;
    IF v_pay.due_date IS NULL THEN v_score_date := 0;
    ELSE v_days_diff := abs(v_bt.transaction_date - v_pay.due_date); v_score_date := GREATEST(0, 20 - v_days_diff);
    END IF;
    v_bank_bonus := 0;
    IF v_pay.payment_bank_account_id IS NOT NULL AND v_pay.payment_bank_account_id = v_bt.bank_account_id THEN
      v_bank_bonus := 10;
    END IF;
    v_score_invoice := 0; v_inv_hit := false;
    v_inv_norm := regexp_replace(lower(coalesce(v_pay.invoice_number, '')), '[^a-z0-9]', '', 'g');
    IF length(v_inv_norm) >= 2 THEN
      v_inv_re := '(^|[^a-z0-9])' || regexp_replace(lower(trim(v_pay.invoice_number)), '[^a-z0-9]+', '[^a-z0-9]{0,3}', 'g') || '([^a-z0-9]|$)';
      IF v_descr ~ v_inv_re THEN
        IF length(v_inv_norm) >= 5 THEN
          v_inv_hit := true; v_score_invoice := CASE WHEN v_amount_diff_pct <= 2 THEN 45 ELSE 15 END;
        ELSIF v_amount_diff_pct <= 2 AND v_name_in_descr THEN
          v_inv_hit := true; v_score_invoice := 45;
        END IF;
      END IF;
    END IF;
    IF v_pay_is_closed AND (NOT (v_name_in_descr OR v_inv_hit) OR v_amount_diff_pct > 5) THEN CONTINUE; END IF;
    v_score_total := LEAST(100, v_score_amount + v_score_name + v_score_date + v_bank_bonus + v_score_invoice);
    IF v_score_total > v_best_score THEN
      v_best_score := v_score_total; v_best_payable_id := v_pay.id; v_best_amount := v_score_amount;
      v_best_name := v_score_name; v_best_date := v_score_date; v_best_is_closed := v_pay_is_closed;
    END IF;
  END LOOP;
  IF v_best_payable_id IS NULL OR v_best_score < 50 THEN
    RETURN jsonb_build_object('matched', false, 'best_score', v_best_score);
  END IF;
  IF v_best_score >= 80 AND NOT v_best_is_closed THEN
    v_match_type := 'auto_exact'; v_log_status := 'applied';
  ELSE
    v_match_type := 'auto_fuzzy'; v_log_status := 'to_confirm';
  END IF;
  INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, score_amount, score_name, score_date, status, notes)
  VALUES (v_bt.company_id, p_bt_id, v_best_payable_id, v_match_type, v_best_score, v_best_amount, v_best_name, v_best_date, v_log_status,
    CASE WHEN v_best_is_closed THEN 'auto-generated: fattura già pagata — conferma aggancio movimento'
         ELSE 'auto-generated by try_match_bank_transaction' END);
  IF v_match_type = 'auto_exact' THEN
    UPDATE public.payables SET bank_transaction_id = p_bt_id, status = 'pagato'::payable_status,
      amount_paid = gross_amount, amount_remaining = 0, payment_date = v_bt.transaction_date, updated_at = now()
    WHERE id = v_best_payable_id;
    UPDATE public.bank_transactions SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_best_payable_id WHERE id = p_bt_id;
  END IF;
  RETURN jsonb_build_object('matched', true, 'payable_id', v_best_payable_id, 'score', v_best_score,
    'match_type', v_match_type, 'closed_manual', v_best_is_closed, 'applied', v_match_type = 'auto_exact');
END;
$function$;

-- try_match_amount_bank_transaction v2 (finestra +30 giorni, nessuna disambiguazione per distinta)
CREATE OR REPLACE FUNCTION public.try_match_amount_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD; v_descr TEXT; v_net NUMERIC := NULL; v_named BOOLEAN := false;
  v_cand RECORD; v_n INT := 0; v_only RECORD; m TEXT;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing'); END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled'); END IF;
  v_descr := coalesce(v_bt.description, '');
  m := (regexp_match(v_descr, 'IMPORTO\s+BONIFICI\s*:?\s*([0-9][0-9.]*,[0-9]{2})', 'i'))[1];
  IF m IS NULL THEN RETURN jsonb_build_object('matched', false, 'reason', 'no_structured_net'); END IF;
  v_net := replace(replace(m, '.', ''), ',', '.')::numeric;
  v_named := public.causale_has_named_beneficiary(v_descr);
  FOR v_cand IN
    SELECT p.* FROM public.payables p
    WHERE p.company_id = v_bt.company_id AND p.bank_transaction_id IS NULL AND p.gross_amount > 0
      AND COALESCE(p.is_placeholder, false) = false
      AND ( p.status IN ('da_pagare', 'in_scadenza', 'scaduto') OR (p.status = 'pagato' AND COALESCE(p.closed_manually, false)) )
      AND NOT EXISTS (SELECT 1 FROM public.payable_credit_note_links l WHERE l.payable_id = p.id AND l.status = 'pending')
      AND abs(p.gross_amount - v_net) <= 0.02
      AND ( NOT v_named OR public.supplier_confirmed_in_text(p.supplier_name, p.supplier_vat, v_descr) )
      AND v_bt.transaction_date BETWEEN COALESCE(p.invoice_date, p.due_date, v_bt.transaction_date) - INTERVAL '120 days'
                                    AND COALESCE(p.due_date, p.invoice_date, v_bt.transaction_date) + INTERVAL '30 days'
  LOOP v_n := v_n + 1; v_only := v_cand; END LOOP;
  IF v_n = 0 THEN RETURN jsonb_build_object('matched', false); END IF;
  IF v_n = 1 THEN
    IF v_only.status = 'pagato' AND COALESCE(v_only.closed_manually, false) THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_only.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 95, 'applied', v_only.gross_amount,
              'auto: IMPORTO BONIFICI netto esatto e univoco (flusso CBI anonimo) — chiusa a mano, solo aggancio');
    ELSE
      UPDATE public.payables SET amount_paid = v_only.gross_amount, amount_remaining = 0, status = 'pagato'::payable_status,
        payment_date = v_bt.transaction_date, bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_only.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 90, 'applied', v_only.gross_amount,
              'auto: IMPORTO BONIFICI netto esatto e univoco (flusso CBI anonimo)');
    END IF;
    UPDATE public.bank_transactions SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_only.id WHERE id = p_bt_id;
    RETURN jsonb_build_object('matched', true, 'auto', true, 'payable_id', v_only.id, 'net', v_net);
  END IF;
  INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
  SELECT v_bt.company_id, p_bt_id, p.id, 'auto_fuzzy', 60, 'to_confirm', p.gross_amount,
         'proposta: IMPORTO BONIFICI netto esatto (flusso CBI anonimo) — piu'' candidati, conferma manuale'
  FROM public.payables p
  WHERE p.company_id = v_bt.company_id AND p.bank_transaction_id IS NULL AND p.gross_amount > 0
    AND COALESCE(p.is_placeholder, false) = false
    AND ( p.status IN ('da_pagare', 'in_scadenza', 'scaduto') OR (p.status = 'pagato' AND COALESCE(p.closed_manually, false)) )
    AND abs(p.gross_amount - v_net) <= 0.02
    AND ( NOT v_named OR public.supplier_confirmed_in_text(p.supplier_name, p.supplier_vat, v_descr) )
    AND v_bt.transaction_date BETWEEN COALESCE(p.invoice_date, p.due_date, v_bt.transaction_date) - INTERVAL '120 days'
                                  AND COALESCE(p.due_date, p.invoice_date, v_bt.transaction_date) + INTERVAL '30 days';
  RETURN jsonb_build_object('matched', false, 'proposed', v_n, 'reason', 'ambiguous_proposed');
END;
$function$;

-- trigger v2 (senza livello distinta)
CREATE OR REPLACE FUNCTION public.trg_auto_reconcile_bank_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE v_res jsonb;
BEGIN
  IF NEW.status IN ('posted', 'booked') AND NEW.amount < 0 THEN
    v_res := public.try_match_group_bank_transaction(NEW.id);
    IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
      v_res := public.try_match_group_numbers_bank_transaction(NEW.id);
      IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
        v_res := public.try_match_bank_transaction(NEW.id);
        IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
          PERFORM public.try_match_amount_bank_transaction(NEW.id);
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- cron v2 (senza passo distinte)
CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE v_group jsonb; v_bij jsonb; v_amt jsonb; v_close jsonb; v_util jsonb; v_riba jsonb;
BEGIN
  v_group := public.rerun_group_reconciliation();
  v_bij := public.rerun_bijective_reconciliation();
  v_amt := public.rerun_amount_reconciliation();
  v_close := public.close_non_supplier_movements();
  v_util := public.close_utility_movements();
  v_riba := public.rerun_riba_provisional_close();
  RETURN jsonb_build_object('granitici', v_group, 'biettivo', v_bij, 'importo_anonimo', v_amt,
                            'chiusi_non_fornitore', v_close, 'chiusi_utenze', v_util,
                            'riba_provvisorie', v_riba, 'run_at', now());
END;
$function$;

DROP FUNCTION IF EXISTS public.rerun_distinta_reconciliation();
DROP FUNCTION IF EXISTS public.try_match_distinta_bank_transaction(uuid);
DROP FUNCTION IF EXISTS public.payable_in_distinta_for_movement(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.bank_movement_net(text);

COMMIT;
