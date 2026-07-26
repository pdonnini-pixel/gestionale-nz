-- =====================================================================
-- Migrazione 114 — Riconciliazione: abbinabile OGNI fattura senza aggancio
-- =====================================================================
-- REGOLA (Patrizio): una fattura si può abbinare a un movimento SEMPRE che non
-- abbia già un aggancio bancario — a prescindere dallo stato. Se è già "pagato"
-- (chiusa a mano OPPURE segnata pagata al go-live/import) ma senza
-- bank_transaction_id, il pagamento reale è rimasto orfano: va agganciato (solo
-- collegamento, nessuna doppia scrittura, la fattura resta pagata).
--
-- BUCO CORRETTO: reconcile_movement e reconcile_movement_group agganciavano le
-- fatture 'pagato' SOLO se `closed_manually = true`. Le fatture 'pagato' con
-- closed_manually=false e senza movimento (es. Palmanova B0202600536/537, pagate
-- all'import) venivano RIFIUTATE (`stale` / `payable_not_matchable`) e restavano
-- impossibili da agganciare, sia a mano sia dal rilevatore di pagamenti cumulativi.
--
-- FIX: il ramo "solo aggancio" scatta per QUALSIASI fattura `status='pagato' AND
-- bank_transaction_id IS NULL` (non più solo le chiuse a mano). Le fatture 'pagato'
-- GIÀ agganciate a un movimento restano intoccabili ('stale'). Nessun'altra logica
-- cambia. Additiva/idempotente. NON distruttiva. Reversibile (ROLLBACK a fianco).
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) reconcile_movement (aggancio SINGOLO)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_movement(p_bt_id uuid, p_payable_id uuid, p_log_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bt RECORD;
  v_pay RECORD;
  v_log RECORD;
  v_remaining NUMERIC;
  v_applied NUMERIC;
  v_nc_applied NUMERIC := 0;
  v_new_remaining NUMERIC;
  v_new_status payable_status;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL THEN
    RAISE EXCEPTION 'Movimento bancario non trovato';
  END IF;

  SELECT * INTO v_pay FROM public.payables WHERE id = p_payable_id;
  IF v_pay IS NULL THEN
    RAISE EXCEPTION 'Fattura non trovata';
  END IF;

  IF v_bt.company_id IS DISTINCT FROM v_pay.company_id THEN
    RAISE EXCEPTION 'Movimento e fattura appartengono ad aziende diverse';
  END IF;

  IF p_log_id IS NOT NULL THEN
    SELECT * INTO v_log FROM public.reconciliation_log WHERE id = p_log_id;
    IF v_log IS NULL OR v_log.status <> 'to_confirm' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'stale');
    END IF;
  END IF;

  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stale');
  END IF;

  -- Ramo "solo aggancio": QUALSIASI fattura già pagata ma senza movimento agganciato
  -- (chiusa a mano o pagata all'import). Nessuna doppia scrittura: resta pagata.
  IF v_pay.status = 'pagato' AND v_pay.bank_transaction_id IS NULL THEN
    UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = p_payable_id;
    UPDATE public.bank_transactions
      SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = p_payable_id
      WHERE id = p_bt_id;
    IF p_log_id IS NOT NULL THEN
      UPDATE public.reconciliation_log
        SET status = 'applied', applied_amount = abs(v_bt.amount), confirmed_at = now(), performed_at = now(),
            notes = COALESCE(notes, '') || ' | agganciato a fattura già pagata senza movimento'
        WHERE id = p_log_id;
    ELSE
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_pay.company_id, p_bt_id, p_payable_id, 'manual', 100, 'applied', abs(v_bt.amount),
              'aggancio a fattura già pagata senza movimento (nessuna doppia scrittura)');
    END IF;
    RETURN jsonb_build_object('ok', true, 'linked_only', true, 'payable_id', p_payable_id, 'bank_transaction_id', p_bt_id);
  END IF;

  v_remaining := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);

  IF v_pay.status IN ('pagato', 'annullato', 'nota_credito') OR v_remaining <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stale');
  END IF;

  v_applied := LEAST(abs(v_bt.amount), v_remaining);

  UPDATE public.payables
  SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
      payment_date = v_bt.transaction_date,
      bank_transaction_id = p_bt_id,
      updated_at = now()
  WHERE id = p_payable_id;

  SELECT amount_remaining INTO v_new_remaining FROM public.payables WHERE id = p_payable_id;
  IF v_new_remaining > 0 THEN
    v_nc_applied := public.apply_credit_note_links(p_payable_id, v_bt.transaction_date);
    IF v_nc_applied > 0 THEN
      UPDATE public.payables
      SET amount_paid = COALESCE(amount_paid, 0) + LEAST(v_nc_applied, v_new_remaining),
          updated_at = now()
      WHERE id = p_payable_id;
    END IF;
  END IF;

  SELECT amount_remaining, status INTO v_new_remaining, v_new_status FROM public.payables WHERE id = p_payable_id;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = p_payable_id
  WHERE id = p_bt_id;

  IF p_log_id IS NOT NULL THEN
    UPDATE public.reconciliation_log
      SET status = 'applied', applied_amount = v_applied, confirmed_at = now(), performed_at = now(),
          notes = COALESCE(notes, '') || ' | confermato manualmente'
                  || CASE WHEN v_nc_applied > 0 THEN ' + NC compensate ' || v_nc_applied ELSE '' END
      WHERE id = p_log_id;
  ELSE
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
    VALUES (v_pay.company_id, p_bt_id, p_payable_id, 'manual', 100, 'applied', v_applied,
            'abbinamento manuale via reconcile_movement'
            || CASE WHEN v_nc_applied > 0 THEN ' (+ NC compensate ' || v_nc_applied || ')' ELSE '' END);
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'payable_id', p_payable_id, 'bank_transaction_id', p_bt_id,
    'applied', v_applied, 'nc_applied', v_nc_applied, 'amount_remaining', v_new_remaining, 'status', v_new_status
  );
END;
$function$;

-- ---------------------------------------------------------------------
-- 2) reconcile_movement_group (aggancio di GRUPPO, atomico)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_movement_group(p_bt_id uuid, p_payable_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bt RECORD;
  v_pay RECORD;
  v_n INT;
  v_mov NUMERIC;
  v_sum_target NUMERIC := 0;
  v_applied NUMERIC;
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

  -- Somma degli importi da agganciare. Ramo "già pagata senza movimento" (chiusa a
  -- mano o pagata all'import): usa il lordo; fatture aperte: usa il residuo.
  FOR v_pay IN
    SELECT * FROM public.payables WHERE id = ANY(p_payable_ids) AND company_id = v_bt.company_id
  LOOP
    IF v_pay.status = 'pagato' AND v_pay.bank_transaction_id IS NULL THEN
      v_sum_target := v_sum_target + v_pay.gross_amount;
    ELSIF v_pay.status IN ('da_pagare', 'in_scadenza', 'scaduto') THEN
      v_sum_target := v_sum_target + COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
    ELSE
      RETURN jsonb_build_object('ok', false, 'reason', 'payable_not_matchable', 'payable_id', v_pay.id, 'status', v_pay.status);
    END IF;
  END LOOP;

  IF abs(v_sum_target - v_mov) > v_tol THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sum_mismatch',
                              'movimento', v_mov, 'somma_fatture', v_sum_target, 'scarto', round(v_sum_target - v_mov, 2));
  END IF;

  FOR v_pay IN
    SELECT * FROM public.payables WHERE id = ANY(p_payable_ids) AND company_id = v_bt.company_id
  LOOP
    IF v_first IS NULL THEN v_first := v_pay.id; END IF;

    IF v_pay.status = 'pagato' AND v_pay.bank_transaction_id IS NULL THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'manual', 100, 'applied', v_pay.gross_amount,
              'pagamento raggruppato (aggancio a fattura già pagata senza movimento)');
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables
      SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
          payment_date = v_bt.transaction_date,
          bank_transaction_id = p_bt_id,
          updated_at = now()
      WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'manual', 100, 'applied', v_applied,
              'pagamento raggruppato (movimento unico su più fatture)');
    END IF;
    v_linked := v_linked + 1;
  END LOOP;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('ok', true, 'grouped', true, 'linked', v_linked,
                            'bank_transaction_id', p_bt_id, 'somma_fatture', v_sum_target, 'movimento', v_mov);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reconcile_movement_group(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_movement_group(uuid, uuid[]) TO authenticated, service_role;
