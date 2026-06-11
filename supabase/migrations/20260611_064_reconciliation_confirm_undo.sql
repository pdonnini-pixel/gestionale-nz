-- Migrazione 064 — Conferma suggerimenti riconciliazione (singola/selezione/tutti) + annullo
-- Estende reconcile_movement per confermare una riga di reconciliation_log 'to_confirm'
-- (idempotente sulle righe stantie -> {ok:false, reason:'stale'}), traccia applied_amount,
-- e aggiunge undo_reconcile_movement per ripristinare esattamente lo stato precedente.
-- Solo ALTER/CREATE OR REPLACE: nessun dato esistente viene riscritto.

-- A.1 colonna per l'undo esatto
ALTER TABLE public.reconciliation_log ADD COLUMN IF NOT EXISTS applied_amount numeric;

-- A.2 reconcile_movement con p_log_id opzionale.
-- Rimuovo la vecchia 2-arg per evitare overload ambiguo: la 3-arg con DEFAULT NULL
-- copre anche le chiamate a 2 argomenti (abbinamento manuale).
DROP FUNCTION IF EXISTS public.reconcile_movement(uuid, uuid);
CREATE OR REPLACE FUNCTION public.reconcile_movement(p_bt_id uuid, p_payable_id uuid, p_log_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bt RECORD;
  v_pay RECORD;
  v_log RECORD;
  v_remaining NUMERIC;
  v_applied NUMERIC;
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

  -- Riga di log da confermare: dev'essere ancora 'to_confirm'
  IF p_log_id IS NOT NULL THEN
    SELECT * INTO v_log FROM public.reconciliation_log WHERE id = p_log_id;
    IF v_log IS NULL OR v_log.status <> 'to_confirm' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'stale');
    END IF;
  END IF;

  v_remaining := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);

  -- Condizioni stantie (race): movimento gia' riconciliato o fattura gia' chiusa/non abbinabile
  IF COALESCE(v_bt.is_reconciled, false)
     OR v_pay.status IN ('pagato', 'annullato', 'nota_credito')
     OR v_remaining <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stale');
  END IF;

  v_applied := LEAST(abs(v_bt.amount), v_remaining);
  v_new_remaining := v_remaining - v_applied;
  v_new_status := CASE WHEN v_new_remaining <= 0 THEN 'pagato'::payable_status ELSE 'parziale'::payable_status END;

  UPDATE public.payables
  SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
      amount_remaining = v_new_remaining,
      status = v_new_status,
      payment_date = v_bt.transaction_date,
      bank_transaction_id = p_bt_id,
      updated_at = now()
  WHERE id = p_payable_id;

  UPDATE public.bank_transactions
  SET is_reconciled = true,
      reconciled_at = now(),
      reconciled_invoice_id = p_payable_id
  WHERE id = p_bt_id;

  IF p_log_id IS NOT NULL THEN
    -- Conferma del suggerimento: aggiorna la riga esistente (match_type resta auto_fuzzy)
    UPDATE public.reconciliation_log
    SET status = 'applied',
        applied_amount = v_applied,
        confirmed_at = now(),
        notes = COALESCE(notes, '') || ' | confermato manualmente'
    WHERE id = p_log_id;
  ELSE
    -- Abbinamento manuale diretto: nuova riga di log
    INSERT INTO public.reconciliation_log (
      company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes
    ) VALUES (
      v_pay.company_id, p_bt_id, p_payable_id, 'manual', 100, 'applied', v_applied,
      'abbinamento manuale via reconcile_movement'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'payable_id', p_payable_id,
    'bank_transaction_id', p_bt_id,
    'applied', v_applied,
    'amount_remaining', v_new_remaining,
    'status', v_new_status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_movement(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_movement(uuid, uuid, uuid) TO authenticated, service_role;

-- A.3 undo_reconcile_movement — ripristino esatto
CREATE OR REPLACE FUNCTION public.undo_reconcile_movement(p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log RECORD;
  v_pay RECORD;
  v_new_paid NUMERIC;
  v_new_remaining NUMERIC;
  v_new_status payable_status;
  v_fully_open BOOLEAN;
BEGIN
  SELECT * INTO v_log FROM public.reconciliation_log WHERE id = p_log_id;
  IF v_log IS NULL OR v_log.status <> 'applied' OR v_log.applied_amount IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_applicable');
  END IF;

  SELECT * INTO v_pay FROM public.payables WHERE id = v_log.payable_id;
  IF v_pay IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payable_not_found');
  END IF;

  v_new_paid := GREATEST(0, COALESCE(v_pay.amount_paid, 0) - v_log.applied_amount);
  v_new_remaining := COALESCE(v_pay.amount_remaining, 0) + v_log.applied_amount;
  v_fully_open := v_new_paid <= 0;
  v_new_status := CASE
    WHEN v_fully_open THEN
      CASE WHEN v_pay.due_date IS NOT NULL AND v_pay.due_date < CURRENT_DATE
           THEN 'scaduto'::payable_status ELSE 'da_pagare'::payable_status END
    ELSE 'parziale'::payable_status
  END;

  UPDATE public.payables
  SET amount_paid = v_new_paid,
      amount_remaining = v_new_remaining,
      status = v_new_status,
      payment_date = CASE WHEN v_fully_open THEN NULL ELSE payment_date END,
      bank_transaction_id = CASE WHEN v_fully_open THEN NULL ELSE bank_transaction_id END,
      updated_at = now()
  WHERE id = v_pay.id;

  IF v_log.bank_transaction_id IS NOT NULL THEN
    UPDATE public.bank_transactions
    SET is_reconciled = false,
        reconciled_at = NULL,
        reconciled_invoice_id = NULL
    WHERE id = v_log.bank_transaction_id;
  END IF;

  UPDATE public.reconciliation_log
  SET status = 'rejected',
      notes = COALESCE(notes, '') || ' | annullato manualmente il ' || to_char(now(), 'DD/MM/YYYY')
  WHERE id = p_log_id;

  RETURN jsonb_build_object(
    'ok', true,
    'payable_id', v_pay.id,
    'restored_remaining', v_new_remaining,
    'status', v_new_status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.undo_reconcile_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_reconcile_movement(uuid) TO authenticated, service_role;
