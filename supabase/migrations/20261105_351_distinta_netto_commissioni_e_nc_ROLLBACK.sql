-- ROLLBACK 351 — ripristina try_match_distinta_bank_transaction com'era prima del 05/11/2026
-- (confronto della disposizione solo con il movimento lordo, nessuna NC applicata).
-- Non annulla gli abbinamenti già fatti: per quelli si usa undo_reconcile_movement(log_id).

CREATE OR REPLACE FUNCTION public.try_match_distinta_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD; v_mov NUMERIC; v_net NUMERIC; v_n INT := 0; v_ids uuid[];
  v_only RECORD; v_applied NUMERIC;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing');
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;

  v_mov := abs(v_bt.amount);
  v_net := public.bank_movement_net(v_bt.description);

  SELECT count(*), array_agg(p.id) INTO v_n, v_ids
  FROM public.payables p
  WHERE p.company_id = v_bt.company_id
    AND p.bank_transaction_id IS NULL
    AND p.gross_amount > 0
    AND COALESCE(p.is_placeholder, false) = false
    AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto', 'parziale', 'pagato')
    AND public.payable_in_distinta_for_movement(p.id, v_bt.bank_account_id, v_bt.transaction_date)
    AND (
      abs(p.gross_amount - v_mov) <= 0.02
      OR (v_net IS NOT NULL AND abs(p.gross_amount - v_net) <= 0.02)
      OR (v_mov > p.gross_amount
          AND (v_mov - p.gross_amount) <= LEAST(5.00, GREATEST(0.50, p.gross_amount * 0.002)))
      OR EXISTS (
        SELECT 1 FROM public.payable_actions a
        WHERE a.payable_id = p.id AND a.action_type = 'disposizione'
          AND a.amount IS NOT NULL AND abs(a.amount - v_mov) <= 0.02
      )
    );

  IF v_n <> 1 THEN
    IF v_n > 1 THEN
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      SELECT v_bt.company_id, p_bt_id, p.id, 'auto_fuzzy', 70, 'to_confirm', p.gross_amount,
             'proposta (distinta): piu'' scadenze disposte su questa banca in queste date con importo compatibile'
      FROM public.payables p WHERE p.id = ANY(v_ids);
    END IF;
    RETURN jsonb_build_object('matched', false, 'reason',
      CASE WHEN v_n = 0 THEN 'no_candidate_in_distinta' ELSE 'ambiguous_in_distinta' END,
      'proposed', COALESCE(v_n, 0));
  END IF;

  SELECT * INTO v_only FROM public.payables WHERE id = v_ids[1];

  IF v_only.status IN ('pagato', 'parziale') THEN
    UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_only.id;
    UPDATE public.bank_transactions
      SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_only.id
      WHERE id = p_bt_id;
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id,
      match_type, confidence, status, applied_amount, notes)
    VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 95, 'applied', 0,
      'auto (distinta): scadenza disposta su questa banca in queste date — gia'' pagata, solo aggancio');
    RETURN jsonb_build_object('matched', true, 'auto', true, 'linked_only', true, 'payable_id', v_only.id);
  END IF;

  v_applied := LEAST(v_mov, COALESCE(v_only.amount_remaining,
                                     v_only.gross_amount - COALESCE(v_only.amount_paid, 0),
                                     v_only.gross_amount));

  UPDATE public.payables
  SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
      payment_date = v_bt.transaction_date,
      bank_transaction_id = p_bt_id,
      updated_at = now()
  WHERE id = v_only.id;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_only.id
  WHERE id = p_bt_id;

  INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id,
    match_type, confidence, status, applied_amount, notes)
  VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 95, 'applied', v_applied,
    'auto (distinta): scadenza disposta su questa banca in queste date, importo compatibile');

  RETURN jsonb_build_object('matched', true, 'auto', true, 'payable_id', v_only.id, 'applied_amount', v_applied);
END;
$function$;
