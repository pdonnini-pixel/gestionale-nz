-- =====================================================================
-- ROLLBACK Migrazione 111 — ripristina try_match_group_bank_transaction alla
-- versione 102 (solo numeri fattura con nucleo numerico >= 4 cifre).
-- =====================================================================
-- NB: gli agganci già creati restano (reconciliation_log + payables.bank_transaction_id);
-- per disfarli usare undo_reconcile_movement caso per caso. Questo rollback rimuove
-- solo la LOGICA dei numeri corti, non tocca i dati.
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.try_match_group_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bt RECORD;
  v_descr TEXT;
  v_mov NUMERIC;
  v_grp RECORD;
  v_pay RECORD;
  v_first UUID := NULL;
  v_linked INT := 0;
  v_applied NUMERIC;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing');
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;

  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));
  v_mov := abs(v_bt.amount);

  SELECT g.supplier_name, g.ids, g.tot INTO v_grp
  FROM (
    SELECT q.supplier_name, array_agg(q.id) AS ids, sum(q.amt) AS tot
    FROM (
      SELECT p.id, p.supplier_name,
        CASE WHEN p.status = 'pagato' THEN p.gross_amount
             ELSE COALESCE(p.amount_remaining, p.gross_amount - COALESCE(p.amount_paid, 0), p.gross_amount) END AS amt
      FROM public.payables p
      WHERE p.company_id = v_bt.company_id
        AND p.bank_transaction_id IS NULL
        AND p.gross_amount > 0
        AND ( p.status IN ('da_pagare', 'in_scadenza', 'scaduto')
              OR (p.status = 'pagato' AND COALESCE(p.closed_manually, false)) )
        AND (
          (p.supplier_vat IS NOT NULL AND v_descr LIKE '%' || lower(p.supplier_vat) || '%')
          OR EXISTS (SELECT 1 FROM regexp_split_to_table(lower(coalesce(p.supplier_name, '')), '[^a-z0-9]+') w
                     WHERE length(w) >= 4 AND position(w in v_descr) > 0)
        )
        AND length(ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0')) >= 4
        AND v_descr ~ ('(^|[^0-9])' || ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0') || '([^0-9]|$)')
    ) q
    GROUP BY q.supplier_name
    HAVING abs(sum(q.amt) - v_mov) <= GREATEST(0.02, v_mov * 0.01)
    ORDER BY count(*) DESC
    LIMIT 1
  ) g;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false);
  END IF;

  FOR v_pay IN SELECT * FROM public.payables WHERE id = ANY(v_grp.ids) LOOP
    IF v_first IS NULL THEN v_first := v_pay.id; END IF;

    IF v_pay.status = 'pagato' AND COALESCE(v_pay.closed_manually, false) AND v_pay.bank_transaction_id IS NULL THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount,
              'auto: fattura citata in causale (chiusa a mano — solo aggancio)');
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables
      SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
          payment_date = v_bt.transaction_date,
          bank_transaction_id = p_bt_id,
          updated_at = now()
      WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_applied,
              'auto: fattura citata in causale (importo esatto)');
    END IF;
    v_linked := v_linked + 1;
  END LOOP;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('matched', true, 'auto', true, 'grouped', (v_linked > 1),
                            'linked', v_linked, 'supplier', v_grp.supplier_name, 'sum', v_grp.tot, 'movimento', v_mov);
END;
$function$;
