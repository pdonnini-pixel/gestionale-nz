-- Migrazione 063 — RPC transazionale di riconciliazione + riattivazione motore automatico
-- Contesto (audit 11/06/2026):
--   * TabRiconciliazione scriveva payables.cash_movement_id (GENERATED ALWAYS) -> ogni
--     abbinamento manuale falliva. Sostituito da RPC reconcile_movement (tutto-o-niente).
--   * Il motore automatico (trigger + rerun) filtrava solo status='posted', ma il default
--     colonna e' 'BOOKED' e import CSV / sync A-Cube scrivono 'booked' -> motore morto.
--   * try_match azzerava lo score quando due_date IS NULL, non dava peso alla banca attesa
--     e non marcava la bank_transaction come riconciliata sul match auto_exact.
-- No data loss: solo UPDATE additivi + backup pre-backfill. Nessun DELETE.

-- ─────────────────────────────────────────────────────────────────────────────
-- C) RPC transazionale di riconciliazione manuale
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reconcile_movement(p_bt_id uuid, p_payable_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bt RECORD;
  v_pay RECORD;
  v_remaining NUMERIC;
  v_applied NUMERIC;
  v_new_remaining NUMERIC;
  v_new_status payable_status;
BEGIN
  -- Carica movimento e fattura
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL THEN
    RAISE EXCEPTION 'Movimento bancario non trovato';
  END IF;

  SELECT * INTO v_pay FROM public.payables WHERE id = p_payable_id;
  IF v_pay IS NULL THEN
    RAISE EXCEPTION 'Fattura non trovata';
  END IF;

  -- Validazioni
  IF v_bt.company_id IS DISTINCT FROM v_pay.company_id THEN
    RAISE EXCEPTION 'Movimento e fattura appartengono ad aziende diverse';
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RAISE EXCEPTION 'Movimento gia'' riconciliato';
  END IF;
  IF v_pay.status IN ('annullato', 'nota_credito') THEN
    RAISE EXCEPTION 'Fattura % non riconciliabile (stato %)', COALESCE(v_pay.invoice_number, ''), v_pay.status;
  END IF;

  -- Importo applicabile = min(valore assoluto movimento, residuo fattura)
  v_remaining := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
  v_applied := LEAST(abs(v_bt.amount), v_remaining);
  v_new_remaining := v_remaining - v_applied;
  v_new_status := CASE WHEN v_new_remaining <= 0 THEN 'pagato'::payable_status ELSE 'parziale'::payable_status END;

  -- Update fattura (NON tocco cash_movement_id: e' GENERATED ALWAYS AS bank_transaction_id)
  UPDATE public.payables
  SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
      amount_remaining = v_new_remaining,
      status = v_new_status,
      payment_date = v_bt.transaction_date,
      bank_transaction_id = p_bt_id,
      updated_at = now()
  WHERE id = p_payable_id;

  -- Update movimento
  UPDATE public.bank_transactions
  SET is_reconciled = true,
      reconciled_at = now(),
      reconciled_invoice_id = p_payable_id
  WHERE id = p_bt_id;

  -- Audit log
  INSERT INTO public.reconciliation_log (
    company_id, bank_transaction_id, payable_id, match_type, confidence, status, notes
  ) VALUES (
    v_pay.company_id, p_bt_id, p_payable_id, 'manual', 100, 'applied',
    'abbinamento manuale via reconcile_movement'
  );

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

REVOKE EXECUTE ON FUNCTION public.reconcile_movement(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_movement(uuid, uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- D) Riattivazione motore automatico
-- ─────────────────────────────────────────────────────────────────────────────

-- D.1 Backup non distruttivo PRIMA del backfill
CREATE TABLE IF NOT EXISTS public.backup_20260611_bank_tx_status AS
  SELECT id, status FROM public.bank_transactions;

-- D.2 Backfill: normalizza 'BOOKED' legacy -> 'booked'
UPDATE public.bank_transactions SET status = 'booked' WHERE status = 'BOOKED';

-- D.3 Default coerente con import CSV / sync A-Cube
ALTER TABLE public.bank_transactions ALTER COLUMN status SET DEFAULT 'booked';

-- D.4 Trigger: processa sia 'posted' sia 'booked'
CREATE OR REPLACE FUNCTION public.trg_auto_reconcile_bank_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Solo movimenti in uscita (pagamenti) gia' contabilizzati
  IF NEW.status IN ('posted', 'booked') AND NEW.amount < 0 THEN
    PERFORM public.try_match_bank_transaction(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- D.5 + D.6 try_match: fix due_date NULL, bonus banca attesa, marca bt riconciliata su auto_exact
CREATE OR REPLACE FUNCTION public.try_match_bank_transaction(p_bt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
  v_score_total NUMERIC;
  v_bank_bonus NUMERIC;
  v_amount_diff_pct NUMERIC;
  v_days_diff INTEGER;
  v_match_type TEXT;
  v_log_status TEXT;
  v_descr TEXT;
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
  LOOP
    -- Asse importo (50pt)
    v_amount_diff_pct := abs(abs(v_bt.amount) - v_pay.gross_amount) / v_pay.gross_amount * 100;
    v_score_amount := GREATEST(0, 50 - v_amount_diff_pct * 5);

    -- Asse nome (30pt)
    v_score_name := 0;
    IF v_pay.supplier_vat IS NOT NULL AND v_descr LIKE '%' || lower(v_pay.supplier_vat) || '%' THEN
      v_score_name := 30;
    ELSIF v_pay.supplier_name IS NOT NULL AND v_descr LIKE '%' || lower(v_pay.supplier_name) || '%' THEN
      v_score_name := 25;
    ELSIF v_pay.supplier_name IS NOT NULL THEN
      v_score_name := similarity(v_descr, lower(v_pay.supplier_name)) * 30;
    END IF;

    -- Asse data (20pt): se due_date NULL non azzerare lo score complessivo -> 0pt su questo asse
    IF v_pay.due_date IS NULL THEN
      v_score_date := 0;
    ELSE
      v_days_diff := abs(v_bt.transaction_date - v_pay.due_date);
      v_score_date := GREATEST(0, 20 - v_days_diff);
    END IF;

    -- Bonus banca attesa (+10): la distinta ha gia' indicato da quale banca pagare
    v_bank_bonus := 0;
    IF v_pay.payment_bank_account_id IS NOT NULL
       AND v_pay.payment_bank_account_id = v_bt.bank_account_id THEN
      v_bank_bonus := 10;
    END IF;

    -- Cap totale a 100 (soglia auto_exact >= 80 invariata)
    v_score_total := LEAST(100, v_score_amount + v_score_name + v_score_date + v_bank_bonus);

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

    -- Marca anche il movimento come riconciliato (prima restava "da riconciliare")
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
$$;

REVOKE EXECUTE ON FUNCTION public.try_match_bank_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_match_bank_transaction(uuid) TO authenticated, service_role;

-- D.5 rerun_reconciliation: processa anche i 'booked'
CREATE OR REPLACE FUNCTION public.rerun_reconciliation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_processed INT := 0;
  v_matched INT := 0;
  v_result jsonb;
BEGIN
  FOR r IN
    SELECT id FROM public.bank_transactions
    WHERE amount < 0 AND status IN ('posted', 'booked')
      AND id NOT IN (SELECT bank_transaction_id FROM public.reconciliation_log WHERE bank_transaction_id IS NOT NULL)
  LOOP
    v_processed := v_processed + 1;
    v_result := public.try_match_bank_transaction(r.id);
    IF (v_result->>'matched')::boolean THEN
      v_matched := v_matched + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'matched', v_matched);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rerun_reconciliation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rerun_reconciliation() TO authenticated, service_role;
