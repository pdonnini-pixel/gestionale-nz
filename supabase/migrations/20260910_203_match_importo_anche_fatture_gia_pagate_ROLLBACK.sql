-- ROLLBACK di 20260910_203 — torna al criterio precedente: fra le fatture già pagate,
-- il match per importo considera SOLO quelle marcate closed_manually o is_provisional_paid.
-- Gli agganci già creati non si sciolgono da soli: si annullano dalla UI
-- (Tesoreria → Riconciliazione → «Annulla abbinamento»), che rimette
-- payables.bank_transaction_id a NULL e riporta il movimento fra i da riconciliare.

CREATE OR REPLACE FUNCTION public.try_match_amount_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD;
  v_descr TEXT;
  v_net NUMERIC := NULL;
  v_named BOOLEAN := false;
  v_n INT := 0;
  v_n_disp INT := 0;
  v_ids uuid[];
  v_disp_id uuid;
  v_only RECORD;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing');
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;

  v_descr := coalesce(v_bt.description, '');
  v_net := public.bank_movement_net(v_descr);
  IF v_net IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'no_structured_net');
  END IF;

  v_named := public.causale_has_named_beneficiary(v_descr);

  WITH cand AS (
    SELECT p.id,
           public.payable_in_distinta_for_movement(p.id, v_bt.bank_account_id, v_bt.transaction_date) AS in_disp
    FROM public.payables p
    WHERE p.company_id = v_bt.company_id
      AND p.bank_transaction_id IS NULL
      AND p.gross_amount > 0
      AND COALESCE(p.is_placeholder, false) = false
      AND ( p.status IN ('da_pagare', 'in_scadenza', 'scaduto')
            OR ( p.status = 'pagato' AND COALESCE(p.closed_manually, false)
                 AND ( p.payment_date IS NULL
                       OR v_bt.transaction_date
                            BETWEEN p.payment_date - INTERVAL '30 days'
                                AND p.payment_date + INTERVAL '30 days' ) )
            OR ( p.status = 'pagato' AND COALESCE(p.is_provisional_paid, false)
                 AND ( p.payment_date IS NULL
                       OR v_bt.transaction_date
                            BETWEEN p.payment_date - INTERVAL '30 days'
                                AND p.payment_date + INTERVAL '60 days' ) ) )
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = p.id AND l.status = 'pending')
      AND abs(p.gross_amount - v_net) <= 0.02
      AND ( NOT v_named
            OR public.supplier_confirmed_in_text(p.supplier_name, p.supplier_vat, v_descr) )
      AND (p.invoice_date IS NULL OR v_bt.transaction_date >= p.invoice_date)
      AND v_bt.transaction_date
            <= COALESCE(p.due_date, p.invoice_date, v_bt.transaction_date) + INTERVAL '180 days'
      AND v_bt.transaction_date
            >= COALESCE(p.due_date, p.invoice_date, v_bt.transaction_date) - INTERVAL '30 days'
  )
  SELECT count(*), count(*) FILTER (WHERE in_disp),
         array_agg(id), (array_agg(id) FILTER (WHERE in_disp))[1]
    INTO v_n, v_n_disp, v_ids, v_disp_id
  FROM cand;

  IF v_n = 0 THEN
    RETURN jsonb_build_object('matched', false);
  END IF;

  IF v_n = 1 THEN
    SELECT * INTO v_only FROM public.payables WHERE id = v_ids[1];
  ELSIF v_n_disp = 1 THEN
    SELECT * INTO v_only FROM public.payables WHERE id = v_disp_id;
  ELSE
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
    SELECT v_bt.company_id, p_bt_id, p.id, 'auto_fuzzy', 60, 'to_confirm', p.gross_amount,
           'proposta: IMPORTO BONIFICI netto esatto (flusso CBI anonimo) — piu'' candidati, conferma manuale'
    FROM public.payables p WHERE p.id = ANY(v_ids);
    RETURN jsonb_build_object('matched', false, 'proposed', v_n, 'reason', 'ambiguous_proposed');
  END IF;

  IF v_only.status = 'pagato' AND (COALESCE(v_only.closed_manually, false) OR COALESCE(v_only.is_provisional_paid, false)) THEN
    UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_only.id;
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
    VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 95, 'applied', v_only.gross_amount,
            'auto: IMPORTO BONIFICI netto esatto e univoco (flusso CBI anonimo) — chiusa a mano o provvisoria, solo aggancio');
  ELSE
    UPDATE public.payables
    SET amount_paid = v_only.gross_amount,
        amount_remaining = 0,
        status = 'pagato'::payable_status,
        payment_date = v_bt.transaction_date,
        bank_transaction_id = p_bt_id,
        updated_at = now()
    WHERE id = v_only.id;
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
    VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 90, 'applied', v_only.gross_amount,
            'auto: IMPORTO BONIFICI netto esatto e univoco (flusso CBI anonimo)');
  END IF;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_only.id
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('matched', true, 'auto', true, 'payable_id', v_only.id, 'net', v_net,
                            'disambiguated_by_distinta', (v_n > 1));
END;
$function$;

REVOKE ALL ON FUNCTION public.try_match_amount_bank_transaction(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_match_amount_bank_transaction(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.try_match_amount_bank_transaction(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.try_match_amount_bank_transaction(uuid) TO service_role;
