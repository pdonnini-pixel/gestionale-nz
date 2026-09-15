-- ROLLBACK migrazione 119 — ripristina try_match_amount_bank_transaction senza il
-- guard sul nome (versione 112) e rimuove l'helper. Additivo/reversibile.
-- ⚠️ REGOLA #0 — NZ + Made + Zago.

CREATE OR REPLACE FUNCTION public.try_match_amount_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bt RECORD;
  v_descr TEXT;
  v_net NUMERIC := NULL;
  v_cand RECORD;
  v_n INT := 0;
  v_only RECORD;
  m TEXT;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing');
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;

  v_descr := coalesce(v_bt.description, '');

  m := (regexp_match(v_descr, 'IMPORTO\s+BONIFICI\s*:?\s*([0-9][0-9.]*,[0-9]{2})', 'i'))[1];
  IF m IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'no_structured_net');
  END IF;
  v_net := replace(replace(m, '.', ''), ',', '.')::numeric;

  FOR v_cand IN
    SELECT p.*
    FROM public.payables p
    WHERE p.company_id = v_bt.company_id
      AND p.bank_transaction_id IS NULL
      AND p.gross_amount > 0
      AND COALESCE(p.is_placeholder, false) = false
      AND ( p.status IN ('da_pagare', 'in_scadenza', 'scaduto')
            OR (p.status = 'pagato' AND COALESCE(p.closed_manually, false)) )
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = p.id AND l.status = 'pending')
      AND abs(p.gross_amount - v_net) <= 0.02
      AND v_bt.transaction_date
            BETWEEN COALESCE(p.invoice_date, p.due_date, v_bt.transaction_date) - INTERVAL '120 days'
                AND COALESCE(p.due_date, p.invoice_date, v_bt.transaction_date) + INTERVAL '30 days'
  LOOP
    v_n := v_n + 1;
    v_only := v_cand;
  END LOOP;

  IF v_n = 0 THEN
    RETURN jsonb_build_object('matched', false);
  END IF;

  IF v_n = 1 THEN
    IF v_only.status = 'pagato' AND COALESCE(v_only.closed_manually, false) THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_only.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 95, 'applied', v_only.gross_amount,
              'auto: IMPORTO BONIFICI netto esatto e univoco (flusso CBI anonimo) — chiusa a mano, solo aggancio');
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

    RETURN jsonb_build_object('matched', true, 'auto', true, 'payable_id', v_only.id, 'net', v_net);
  END IF;

  INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
  SELECT v_bt.company_id, p_bt_id, p.id, 'auto_fuzzy', 60, 'to_confirm', p.gross_amount,
         'proposta: IMPORTO BONIFICI netto esatto (flusso CBI anonimo) — piu'' candidati, conferma manuale'
  FROM public.payables p
  WHERE p.company_id = v_bt.company_id
    AND p.bank_transaction_id IS NULL
    AND p.gross_amount > 0
    AND COALESCE(p.is_placeholder, false) = false
    AND ( p.status IN ('da_pagare', 'in_scadenza', 'scaduto')
          OR (p.status = 'pagato' AND COALESCE(p.closed_manually, false)) )
    AND abs(p.gross_amount - v_net) <= 0.02
    AND v_bt.transaction_date
          BETWEEN COALESCE(p.invoice_date, p.due_date, v_bt.transaction_date) - INTERVAL '120 days'
              AND COALESCE(p.due_date, p.invoice_date, v_bt.transaction_date) + INTERVAL '30 days';

  RETURN jsonb_build_object('matched', false, 'proposed', v_n, 'reason', 'ambiguous_proposed');
END;
$function$;

DROP FUNCTION IF EXISTS public.causale_has_named_beneficiary(text);
