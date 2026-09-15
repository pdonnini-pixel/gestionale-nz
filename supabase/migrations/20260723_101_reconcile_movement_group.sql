-- =====================================================================
-- Migrazione 101 — Riconciliazione: pagamento RAGGRUPPATO (1 movimento → N fatture)
-- =====================================================================
-- CONTESTO: molti bonifici pagano più fatture dello stesso fornitore in un colpo
-- solo (es. SFORAZZINI −466,95 = fattura 5421 155,65 + fattura 5422 311,30).
-- reconcile_movement collega un movimento a UNA sola fattura e marca subito il
-- movimento come riconciliato, quindi non era possibile spalmarlo su più fatture.
--
-- Questa RPC collega, in modo ATOMICO, un singolo movimento a N fatture:
--   • per ogni fattura APERTA applica il pagamento (amount_paid += residuo);
--   • per ogni fattura già CHIUSA A MANO (pagato + closed_manually, senza
--     movimento) fa solo l'aggancio, senza doppia scrittura (fattura resta pagata);
--   • marca il movimento riconciliato UNA volta sola alla fine;
--   • logga una riga reconciliation_log per fattura, con nota "pagamento raggruppato".
--
-- SALVAGUARDIE (mai approssimativo):
--   • tutte le fatture devono appartenere alla stessa azienda del movimento;
--   • la somma degli importi da agganciare deve COINCIDERE con l'importo del
--     movimento (tolleranza 2% o 5 cent): se non torna, NON esegue nulla e
--     restituisce lo scarto, così la contabile capisce e decide;
--   • se il movimento è già riconciliato → 'stale' (nessuna doppia scrittura);
--   • fattura non abbinabile (annullato/nota_credito/già pagata con movimento) →
--     l'intera operazione fallisce (transazione, tutto-o-niente).
--
-- Additiva/idempotente (CREATE OR REPLACE). NON distruttiva.
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago.
-- =====================================================================

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

  -- Verifica appartenenza + calcolo somma degli importi da agganciare.
  SELECT count(*) INTO v_n FROM public.payables
   WHERE id = ANY(p_payable_ids) AND company_id = v_bt.company_id;
  IF v_n <> array_length(p_payable_ids, 1) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payable_mismatch');
  END IF;

  FOR v_pay IN
    SELECT * FROM public.payables WHERE id = ANY(p_payable_ids) AND company_id = v_bt.company_id
  LOOP
    IF v_pay.status = 'pagato' AND COALESCE(v_pay.closed_manually, false) AND v_pay.bank_transaction_id IS NULL THEN
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

  -- Esecuzione (atomica). Aggancio per fattura.
  FOR v_pay IN
    SELECT * FROM public.payables WHERE id = ANY(p_payable_ids) AND company_id = v_bt.company_id
  LOOP
    IF v_first IS NULL THEN v_first := v_pay.id; END IF;

    IF v_pay.status = 'pagato' AND COALESCE(v_pay.closed_manually, false) AND v_pay.bank_transaction_id IS NULL THEN
      -- fattura chiusa a mano: solo aggancio, nessuna doppia scrittura
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'manual', 100, 'applied', v_pay.gross_amount,
              'pagamento raggruppato (aggancio a fattura chiusa a mano)');
    ELSE
      -- fattura aperta: applica il residuo
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

  -- Marca il movimento riconciliato una sola volta (collegato alla prima fattura del gruppo).
  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('ok', true, 'grouped', true, 'linked', v_linked,
                            'bank_transaction_id', p_bt_id, 'somma_fatture', v_sum_target, 'movimento', v_mov);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reconcile_movement_group(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_movement_group(uuid, uuid[]) TO authenticated, service_role;
