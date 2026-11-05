-- ============================================================================
-- 350 — Distinta: si confronta l'importo netto del bonifico e si scalano le NC
-- ============================================================================
-- Nata il 05/11/2026 dal caso WOLF GROUP fattura 285 (NZ). Il 22/10/2026 la rata 2
-- (9.970,87) è stata messa in distinta per 9.665,75, cioè al netto delle note di
-- credito n.92 (67,22) e n.109 (237,90). Lo stesso giorno MPS ha addebitato
-- 9.666,25: 9.665,75 di bonifico più 0,50 di commissioni (flusso CBI anonimo, senza
-- nome del fornitore). La scadenza è rimasta «In distinta» per due settimane.
--
-- PERCHÉ NON SI ABBINAVA
-- `try_match_distinta_bank_transaction` confrontava l'importo della disposizione
-- (9.665,75) solo con il movimento LORDO (9.666,25): 0,50 di scarto, oltre la
-- tolleranza di 0,02. Il netto del flusso CBI (`bank_movement_net`) veniva usato
-- solo contro il lordo della fattura (9.970,87), che senza le NC non torna.
--
-- COSA CAMBIA
-- 1. L'importo della disposizione si confronta anche con il NETTO del movimento.
-- 2. L'importo applicato alla fattura è il netto del movimento quando c'è (le
--    commissioni non pagano la fattura), non il lordo.
-- 3. Se dopo il bonifico la fattura ha ancora un residuo, si applicano le NC
--    collegate in distinta (`apply_credit_note_links`), come fa già
--    `reconcile_movement` nell'abbinamento manuale. Così la rata va a «pagato» e le
--    NC risultano usate, invece di restare la rata «parziale» per 304,62.
--
-- COSA NON FA
-- · non tocca nessun movimento o fattura già abbinati;
-- · non cambia la scelta dei candidati se non per il punto 1 (resta l'obbligo di
--   una sola scadenza in distinta su quella banca in quelle date);
-- · misura del 05/11/2026 prima dell'applicazione: su NZ un solo movimento ricade nel
--   punto 1 (WOLF 285), su Zago nessuno.
--
-- Tenant: NZ e Zago (Made escluso dal 03/11/2026, vedi CLAUDE.md).
-- Rollback: 20261105_350_distinta_netto_commissioni_e_nc_ROLLBACK.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.try_match_distinta_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD; v_mov NUMERIC; v_net NUMERIC; v_n INT := 0; v_ids uuid[];
  v_only RECORD; v_applied NUMERIC; v_remaining NUMERIC; v_nc NUMERIC := 0;
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
          AND a.amount IS NOT NULL
          AND (abs(a.amount - v_mov) <= 0.02
               OR (v_net IS NOT NULL AND abs(a.amount - v_net) <= 0.02))
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

  -- Le commissioni non pagano la fattura: si applica il netto del flusso CBI se c'è.
  v_applied := LEAST(COALESCE(v_net, v_mov), COALESCE(v_only.amount_remaining,
                                     v_only.gross_amount - COALESCE(v_only.amount_paid, 0),
                                     v_only.gross_amount));

  UPDATE public.payables
  SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
      payment_date = v_bt.transaction_date,
      bank_transaction_id = p_bt_id,
      updated_at = now()
  WHERE id = v_only.id;

  -- Residuo dopo il bonifico: le NC collegate in distinta lo chiudono.
  SELECT amount_remaining INTO v_remaining FROM public.payables WHERE id = v_only.id;
  IF v_remaining > 0 THEN
    v_nc := public.apply_credit_note_links(v_only.id, v_bt.transaction_date);
    IF v_nc > 0 THEN
      UPDATE public.payables
      SET amount_paid = COALESCE(amount_paid, 0) + LEAST(v_nc, v_remaining),
          updated_at = now()
      WHERE id = v_only.id;
    END IF;
  END IF;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_only.id
  WHERE id = p_bt_id;

  INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id,
    match_type, confidence, status, applied_amount, notes)
  VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 95, 'applied', v_applied,
    'auto (distinta): scadenza disposta su questa banca in queste date, importo compatibile'
    || CASE WHEN v_nc > 0 THEN ' (+ NC compensate ' || v_nc || ')' ELSE '' END);

  RETURN jsonb_build_object('matched', true, 'auto', true, 'payable_id', v_only.id,
                            'applied_amount', v_applied, 'nc_applied', v_nc);
END;
$function$;
