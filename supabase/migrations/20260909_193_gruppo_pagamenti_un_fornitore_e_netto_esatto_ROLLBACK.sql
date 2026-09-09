-- ROLLBACK di 20260909_193 — ripristina reconcile_movement_group com'era prima:
-- tolleranza del 2% calcolata sul LORDO e nessun controllo che le fatture del gruppo
-- siano dello stesso fornitore. Da usare solo se il vincolo stretto blocca gruppi
-- legittimi; in quel caso conviene prima capire QUALE gruppo, perché uno scarto sui
-- bonifici corporate banking di norma significa gruppo sbagliato.

CREATE OR REPLACE FUNCTION public.reconcile_movement_group(p_bt_id uuid, p_payable_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD;
  v_pay RECORD;
  v_n INT;
  v_mov NUMERIC;
  v_sum_target NUMERIC := 0;
  v_applied NUMERIC;
  v_nc NUMERIC;
  v_tol NUMERIC;
  v_first UUID := NULL;
  v_linked INT := 0;
BEGIN
  IF p_payable_ids IS NULL OR array_length(p_payable_ids, 1) IS NULL OR array_length(p_payable_ids, 1) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'need_at_least_two_payables');
  END IF;

  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL THEN
    RAISE EXCEPTION 'Movimento bancario non trovato';
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stale');
  END IF;

  v_mov := abs(v_bt.amount);
  v_tol := GREATEST(0.05, v_mov * 0.02);

  SELECT count(*) INTO v_n FROM public.payables
   WHERE id = ANY(p_payable_ids) AND company_id = v_bt.company_id;
  IF v_n <> array_length(p_payable_ids, 1) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payable_mismatch');
  END IF;

  FOR v_pay IN
    SELECT * FROM public.payables WHERE id = ANY(p_payable_ids) AND company_id = v_bt.company_id
  LOOP
    IF v_pay.gross_amount < 0 THEN
      v_sum_target := v_sum_target - abs(v_pay.gross_amount);
    ELSE
      SELECT COALESCE(sum(amount), 0) INTO v_nc
        FROM public.payable_credit_note_links
       WHERE payable_id = v_pay.id AND status = 'pending'
         AND credit_note_payable_id <> ALL(p_payable_ids);
      IF v_pay.status = 'pagato' AND v_pay.bank_transaction_id IS NULL THEN
        v_sum_target := v_sum_target + v_pay.gross_amount - v_nc;
      ELSIF v_pay.status IN ('da_pagare', 'in_scadenza', 'scaduto') THEN
        v_sum_target := v_sum_target + COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount) - v_nc;
      ELSE
        RETURN jsonb_build_object('ok', false, 'reason', 'payable_not_matchable', 'payable_id', v_pay.id, 'status', v_pay.status);
      END IF;
    END IF;
  END LOOP;

  IF abs(v_sum_target - v_mov) > v_tol THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sum_mismatch',
                              'movimento', v_mov, 'somma_netto_nc', v_sum_target, 'scarto', round(v_sum_target - v_mov, 2));
  END IF;

  FOR v_pay IN
    SELECT * FROM public.payables WHERE id = ANY(p_payable_ids) AND company_id = v_bt.company_id
  LOOP
    IF v_pay.gross_amount < 0 THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'manual', 100, 'applied', v_pay.gross_amount,
              'pagamento raggruppato — nota di credito scalata nel gruppo');
      v_linked := v_linked + 1;
      CONTINUE;
    END IF;

    IF v_first IS NULL THEN v_first := v_pay.id; END IF;

    SELECT COALESCE(sum(amount), 0) INTO v_nc
      FROM public.payable_credit_note_links
     WHERE payable_id = v_pay.id AND status = 'pending'
       AND credit_note_payable_id <> ALL(p_payable_ids);

    IF v_pay.status = 'pagato' AND v_pay.bank_transaction_id IS NULL THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      IF v_nc > 0 THEN
        UPDATE public.payable_credit_note_links SET status = 'applied', applied_at = now()
         WHERE payable_id = v_pay.id AND status = 'pending' AND credit_note_payable_id <> ALL(p_payable_ids);
      END IF;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'manual', 100, 'applied', v_pay.gross_amount - v_nc,
              'pagamento raggruppato (già pagata; netto NC)');
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables
      SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
          payment_date = v_bt.transaction_date,
          bank_transaction_id = p_bt_id,
          updated_at = now()
      WHERE id = v_pay.id;
      IF v_nc > 0 THEN
        UPDATE public.payable_credit_note_links SET status = 'applied', applied_at = now()
         WHERE payable_id = v_pay.id AND status = 'pending' AND credit_note_payable_id <> ALL(p_payable_ids);
      END IF;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'manual', 100, 'applied', v_applied - v_nc,
              'pagamento raggruppato (movimento unico su più fatture; netto NC)');
    END IF;
    v_linked := v_linked + 1;
  END LOOP;

  IF v_first IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'only_credit_notes');
  END IF;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('ok', true, 'grouped', true, 'linked', v_linked,
                            'bank_transaction_id', p_bt_id, 'somma_netto_nc', v_sum_target, 'movimento', v_mov);
END;
$function$;

-- CREATE OR REPLACE su SECURITY DEFINER rimette EXECUTE a PUBLIC: si ripristinano i grant.
REVOKE ALL ON FUNCTION public.reconcile_movement_group(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_movement_group(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.reconcile_movement_group(uuid, uuid[]) TO authenticated, service_role;
