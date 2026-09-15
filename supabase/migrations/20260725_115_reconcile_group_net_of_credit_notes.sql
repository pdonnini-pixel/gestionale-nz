-- =====================================================================
-- Migrazione 115 — Riconciliazione di gruppo AL NETTO delle note di credito
-- =====================================================================
-- REGOLA (Patrizio): quando un bonifico paga una distinta con dentro una NOTA DI
-- CREDITO, l'importo bonificato è il NETTO = somma fatture − note di credito. Il
-- motore deve confrontare quel netto, non il lordo delle sole fatture.
--
-- CASO REALE (New Zago, distinta Torino Fashion Village del 23/07, bonifico 24/07):
--   fatture 1323 (20.740,00) + 1120 (6.636,80) + 1222 (5.807,20) = 33.184,00
--   − NC 1380 (4.771,73, già collegata alla 1120 in payable_credit_note_links pending)
--   = 28.412,27  → esattamente il netto del bonifico (lordo 28.414,02 con 1,75 comm.).
-- reconcile_movement_group sommava 33.184,00 e falliva con sum_mismatch.
--
-- FIX: per ogni fattura del gruppo si sottrae dalla somma-obiettivo l'importo delle
-- NC ad essa collegate con stato 'pending'; in esecuzione, oltre ad agganciare/saldare
-- la fattura, si CONSUMANO quelle NC (link → 'applied'). Così la somma del gruppo
-- coincide col netto bonificato e la nota di credito viene registrata come usata.
-- La tolleranza (0,02 / 2%) continua ad assorbire l'eventuale commissione bancaria.
--
-- Additiva/idempotente (CREATE OR REPLACE). NON distruttiva. Reversibile con
-- undo_reconcile_movement (che riapre anche le NC). ⚠️ REGOLA #0 — NZ + Made + Zago.
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

  -- Somma-obiettivo AL NETTO delle NC pending collegate a ciascuna fattura.
  FOR v_pay IN
    SELECT * FROM public.payables WHERE id = ANY(p_payable_ids) AND company_id = v_bt.company_id
  LOOP
    SELECT COALESCE(sum(amount), 0) INTO v_nc
      FROM public.payable_credit_note_links
     WHERE payable_id = v_pay.id AND status = 'pending';

    IF v_pay.status = 'pagato' AND v_pay.bank_transaction_id IS NULL THEN
      v_sum_target := v_sum_target + v_pay.gross_amount - v_nc;
    ELSIF v_pay.status IN ('da_pagare', 'in_scadenza', 'scaduto') THEN
      v_sum_target := v_sum_target + COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount) - v_nc;
    ELSE
      RETURN jsonb_build_object('ok', false, 'reason', 'payable_not_matchable', 'payable_id', v_pay.id, 'status', v_pay.status);
    END IF;
  END LOOP;

  IF abs(v_sum_target - v_mov) > v_tol THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sum_mismatch',
                              'movimento', v_mov, 'somma_fatture_netto_nc', v_sum_target, 'scarto', round(v_sum_target - v_mov, 2));
  END IF;

  FOR v_pay IN
    SELECT * FROM public.payables WHERE id = ANY(p_payable_ids) AND company_id = v_bt.company_id
  LOOP
    IF v_first IS NULL THEN v_first := v_pay.id; END IF;

    SELECT COALESCE(sum(amount), 0) INTO v_nc
      FROM public.payable_credit_note_links
     WHERE payable_id = v_pay.id AND status = 'pending';

    IF v_pay.status = 'pagato' AND v_pay.bank_transaction_id IS NULL THEN
      -- già pagata senza movimento: solo aggancio; la NC eventuale si consuma.
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      IF v_nc > 0 THEN
        UPDATE public.payable_credit_note_links SET status = 'applied', applied_at = now()
         WHERE payable_id = v_pay.id AND status = 'pending';
      END IF;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'manual', 100, 'applied', v_pay.gross_amount - v_nc,
              'pagamento raggruppato (già pagata; netto NC ' || v_nc || ')');
    ELSE
      -- fattura aperta: la si salda per intero (cassa + NC), consumando le NC pending.
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables
      SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
          payment_date = v_bt.transaction_date,
          bank_transaction_id = p_bt_id,
          updated_at = now()
      WHERE id = v_pay.id;
      IF v_nc > 0 THEN
        UPDATE public.payable_credit_note_links SET status = 'applied', applied_at = now()
         WHERE payable_id = v_pay.id AND status = 'pending';
      END IF;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'manual', 100, 'applied', v_applied - v_nc,
              'pagamento raggruppato (movimento unico su più fatture; netto NC ' || v_nc || ')');
    END IF;
    v_linked := v_linked + 1;
  END LOOP;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('ok', true, 'grouped', true, 'linked', v_linked,
                            'bank_transaction_id', p_bt_id, 'somma_netto_nc', v_sum_target, 'movimento', v_mov);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reconcile_movement_group(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_movement_group(uuid, uuid[]) TO authenticated, service_role;
