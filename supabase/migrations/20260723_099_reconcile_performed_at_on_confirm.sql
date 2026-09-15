-- 099 — riconciliazione: performed_at = now() quando si conferma un suggerimento
--
-- PROBLEMA: reconcile_movement, sul ramo "conferma di un suggerimento esistente"
-- (p_log_id valorizzato), impostava confirmed_at = now() ma NON aggiornava
-- performed_at. Il pannello "Riconciliati oggi" filtra per performed_at (data del
-- suggerimento), quindi una riconciliazione confermata oggi ma suggerita in un
-- altro giorno veniva conteggiata nel giorno sbagliato.
--
-- FIX: aggiungere performed_at = now() alle due UPDATE reconciliation_log che
-- portano lo stato a 'applied' su p_log_id. Così la riconciliazione è sempre
-- attribuita al giorno in cui viene effettivamente applicata. Il resto della
-- funzione è identico (guardia anti-doppio inclusa).
--
-- Additivo/non distruttivo. ⚠️ PARITÀ TENANT: NZ + Made + Zago.

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

  IF v_pay.status = 'pagato' AND COALESCE(v_pay.closed_manually, false) AND v_pay.bank_transaction_id IS NULL THEN
    UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = p_payable_id;
    UPDATE public.bank_transactions
      SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = p_payable_id
      WHERE id = p_bt_id;
    IF p_log_id IS NOT NULL THEN
      UPDATE public.reconciliation_log
        SET status = 'applied', applied_amount = abs(v_bt.amount), confirmed_at = now(), performed_at = now(),
            notes = COALESCE(notes, '') || ' | agganciato a fattura chiusa a mano'
        WHERE id = p_log_id;
    ELSE
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_pay.company_id, p_bt_id, p_payable_id, 'manual', 100, 'applied', abs(v_bt.amount),
              'aggancio a fattura chiusa a mano (nessuna doppia scrittura)');
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
