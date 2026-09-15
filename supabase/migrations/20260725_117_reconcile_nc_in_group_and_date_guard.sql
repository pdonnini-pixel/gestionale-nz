-- =====================================================================
-- Migrazione 117 — Note di credito "vaganti" nel gruppo + guardia anti "pagato prima"
-- =====================================================================
-- GAP #1 (completamento): le note di credito spesso NON sono collegate a una fattura
-- (payable_credit_note_links): sono semplici payables a importo NEGATIVO dello stesso
-- fornitore. reconcile_movement_group ora accetta anche queste NC passate nel gruppo e
-- le SOTTRAE dal target (oltre a quelle collegate, gestite dalla 115). Così una distinta
-- pagata al netto di NC si abbina sia con NC collegata (Torino) sia con NC vagante
-- (Valdichiana: 27.159,16 + 9.382,26 − 457,50 = 36.083,92).
--
-- GAP #2: il matcher biettivo poteva agganciare un movimento a una fattura emessa
-- MOLTO DOPO la data del movimento (impossibile: non si paga prima che la fattura
-- esista). Su importi duplicati questo causava cross-link al mese sbagliato (es. fattura
-- di aprile agganciata a un addebito di gennaio). Aggiunta guardia: il movimento non può
-- precedere di oltre 15 giorni la data fattura.
--
-- Additiva/idempotente. Reversibile (undo_reconcile_movement). ⚠️ NZ + Made + Zago.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) reconcile_movement_group: NC nel gruppo (vaganti) + NC collegate (115) + no doppio conteggio
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

  -- Somma-obiettivo. NC nel gruppo (gross < 0) → riducono. Per le fatture positive si
  -- sottrae anche l'eventuale NC collegata (pending) NON già passata nel gruppo.
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
      -- NC vagante: la si "consuma" agganciandola al movimento (non riusabile).
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
              'pagamento raggruppato (già pagata; netto NC ' || v_nc || ')');
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
              'pagamento raggruppato (movimento unico su più fatture; netto NC ' || v_nc || ')');
    END IF;
    v_linked := v_linked + 1;
  END LOOP;

  IF v_first IS NULL THEN
    -- gruppo di sole NC: incoerente, non riconciliare.
    RETURN jsonb_build_object('ok', false, 'reason', 'only_credit_notes');
  END IF;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('ok', true, 'grouped', true, 'linked', v_linked,
                            'bank_transaction_id', p_bt_id, 'somma_netto_nc', v_sum_target, 'movimento', v_mov);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reconcile_movement_group(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_movement_group(uuid, uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2) rerun_bijective_reconciliation: guardia "movimento non prima della fattura"
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rerun_bijective_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pay RECORD;
  v_bt RECORD;
  v_applied NUMERIC;
  v_pairs INT := 0;
  v_inv_date DATE;
BEGIN
  FOR v_pay IN
    SELECT * FROM public.payables
    WHERE bank_transaction_id IS NULL
      AND gross_amount > 0
      AND supplier_name IS NOT NULL
      AND status IN ('da_pagare', 'in_scadenza', 'scaduto', 'pagato')
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = payables.id AND l.status = 'pending')
    ORDER BY company_id, supplier_name, gross_amount,
             COALESCE(invoice_date, due_date, created_at::date)
  LOOP
    v_inv_date := COALESCE(v_pay.invoice_date, v_pay.due_date, v_pay.created_at::date);

    SELECT bt.* INTO v_bt
    FROM public.bank_transactions bt
    WHERE bt.company_id = v_pay.company_id
      AND bt.amount < 0
      AND COALESCE(bt.is_reconciled, false) = false
      AND bt.status IN ('posted', 'booked')
      AND abs(abs(bt.amount) - v_pay.gross_amount) <= GREATEST(0.02, v_pay.gross_amount * 0.01)
      -- GAP #2: non si paga prima che la fattura esista (tolleranza 15 gg per anticipi/lag).
      AND bt.transaction_date >= v_inv_date - INTERVAL '15 days'
      AND public.supplier_confirmed_in_text(
            v_pay.supplier_name, v_pay.supplier_vat,
            coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '') || ' ' || coalesce(bt.merchant_name, ''))
    ORDER BY abs(bt.transaction_date - v_inv_date) ASC, bt.transaction_date DESC
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_pay.status = 'pagato' THEN
      UPDATE public.payables SET bank_transaction_id = v_bt.id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_pay.company_id, v_bt.id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount,
              'auto: abbinamento per data — stesso fornitore/importo (già pagata)');
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables
      SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
          payment_date = v_bt.transaction_date,
          bank_transaction_id = v_bt.id,
          updated_at = now()
      WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_pay.company_id, v_bt.id, v_pay.id, 'auto_exact', 100, 'applied', v_applied,
              'auto: abbinamento per data — stesso fornitore/importo');
    END IF;

    UPDATE public.bank_transactions
    SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_pay.id
    WHERE id = v_bt.id;

    v_pairs := v_pairs + 1;
  END LOOP;

  RETURN jsonb_build_object('coppie_abbinate', v_pairs);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rerun_bijective_reconciliation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rerun_bijective_reconciliation() TO authenticated, service_role;
