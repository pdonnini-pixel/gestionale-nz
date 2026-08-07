-- =====================================================================
-- ROLLBACK Migrazione 149 — ripristina i 3 matcher alla versione precedente
-- (numero fattura = solo concatenato completo) e rimuove i 2 helper.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.try_match_group_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bt RECORD; v_descr TEXT; v_mov NUMERIC; v_grp RECORD; v_pay RECORD;
  v_first UUID := NULL; v_linked INT := 0; v_applied NUMERIC;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing'); END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled'); END IF;
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
      WHERE p.company_id = v_bt.company_id AND p.bank_transaction_id IS NULL AND p.gross_amount > 0
        AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto', 'pagato')
        AND public.supplier_confirmed_in_text(p.supplier_name, p.supplier_vat, v_descr)
        AND (
          ( length(ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0')) >= 4
            AND v_descr ~ ('(^|[^0-9])' || ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0') || '([^0-9]|$)') )
          OR
          ( length(ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0')) BETWEEN 2 AND 3
            AND v_descr ~ '(saldo|fattura|fatt|nota|parcella)'
            AND v_descr ~ ('(^|[^0-9])' || ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0') || '([^0-9]|$)') )
          OR
          ( length(regexp_replace(lower(coalesce(p.invoice_number, '')), '[^a-z0-9]', '', 'g')) >= 4
            AND v_descr ~ ('(^|[^a-z0-9])' || regexp_replace(lower(trim(coalesce(p.invoice_number, ''))), '[^a-z0-9]+', '[^a-z0-9]{0,3}', 'g') || '([^a-z0-9]|$)') )
        )
    ) q
    GROUP BY q.supplier_name
    HAVING abs(sum(q.amt) - v_mov) <= GREATEST(0.02, v_mov * 0.01)
    ORDER BY count(*) DESC
    LIMIT 1
  ) g;
  IF NOT FOUND THEN RETURN jsonb_build_object('matched', false); END IF;
  FOR v_pay IN SELECT * FROM public.payables WHERE id = ANY(v_grp.ids) LOOP
    IF v_first IS NULL THEN v_first := v_pay.id; END IF;
    IF v_pay.status = 'pagato' AND v_pay.bank_transaction_id IS NULL THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount, 'auto: fattura citata in causale (già pagata — solo aggancio)');
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables SET amount_paid = COALESCE(amount_paid, 0) + v_applied, payment_date = v_bt.transaction_date, bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_applied, 'auto: fattura citata in causale (importo esatto)');
    END IF;
    v_linked := v_linked + 1;
  END LOOP;
  UPDATE public.bank_transactions SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first WHERE id = p_bt_id;
  RETURN jsonb_build_object('matched', true, 'auto', true, 'grouped', (v_linked > 1), 'linked', v_linked, 'supplier', v_grp.supplier_name, 'sum', v_grp.tot, 'movimento', v_mov);
END;
$function$;

CREATE OR REPLACE FUNCTION public.try_match_group_numbers_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bt RECORD; v_descr TEXT; v_mov NUMERIC; v_cnt INT; v_ids uuid[]; v_tot NUMERIC;
  v_pay RECORD; v_first UUID := NULL; v_linked INT := 0; v_applied NUMERIC;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing'); END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled'); END IF;
  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));
  v_mov := abs(v_bt.amount);
  WITH hits AS (
    SELECT p.id, COALESCE(p.supplier_id::text, p.supplier_name) AS sid,
           CASE WHEN p.status = 'pagato' THEN p.gross_amount
                ELSE COALESCE(p.amount_remaining, p.gross_amount - COALESCE(p.amount_paid, 0), p.gross_amount) END AS amt
    FROM public.payables p
    WHERE p.company_id = v_bt.company_id AND p.bank_transaction_id IS NULL AND p.gross_amount > 0
      AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto', 'pagato')
      AND length(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g')) >= 6
      AND v_descr ~ ('(^|[^0-9])' || regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g') || '([^0-9]|$)')
  ),
  grp AS (
    SELECT sid, array_agg(id) AS ids, sum(amt) AS tot FROM hits GROUP BY sid
    HAVING abs(sum(amt) - v_mov) <= GREATEST(0.02, v_mov * 0.01)
  )
  SELECT (SELECT count(*) FROM grp), g.ids, g.tot INTO v_cnt, v_ids, v_tot FROM grp g LIMIT 1;
  IF v_cnt IS NULL OR v_cnt <> 1 THEN RETURN jsonb_build_object('matched', false, 'reason', 'ambiguous_or_none'); END IF;
  FOR v_pay IN SELECT * FROM public.payables WHERE id = ANY(v_ids) LOOP
    IF v_first IS NULL THEN v_first := v_pay.id; END IF;
    IF v_pay.status = 'pagato' AND v_pay.bank_transaction_id IS NULL THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount, 'auto: numero fattura citato in causale — SDD cumulativo (già pagata, solo aggancio)');
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables SET amount_paid = COALESCE(amount_paid, 0) + v_applied, payment_date = v_bt.transaction_date, bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_applied, 'auto: numero fattura citato in causale — SDD cumulativo (importo esatto)');
    END IF;
    v_linked := v_linked + 1;
  END LOOP;
  UPDATE public.bank_transactions SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first WHERE id = p_bt_id;
  RETURN jsonb_build_object('matched', true, 'auto', true, 'grouped', (v_linked > 1), 'linked', v_linked, 'sum', v_tot, 'movimento', v_mov, 'by', 'invoice_numbers');
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_utility_movements()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n INT;
BEGIN
  WITH upd AS (
    UPDATE public.bank_transactions bt
    SET is_reconciled = true, reconciled_at = now(), category = COALESCE(bt.category, 'utenze'),
        note = COALESCE(bt.note || ' | ', '') || 'chiuso automaticamente (utenza — addebito permanente)'
    WHERE bt.amount < 0 AND COALESCE(bt.is_reconciled, false) = false AND bt.status IN ('posted', 'booked')
      AND NOT EXISTS (SELECT 1 FROM public.reconciliation_log rl WHERE rl.bank_transaction_id = bt.id AND rl.status IN ('applied', 'to_confirm'))
      AND NOT EXISTS (
        SELECT 1 FROM public.payables p2
        WHERE p2.company_id = bt.company_id AND p2.bank_transaction_id IS NULL AND p2.gross_amount > 0
          AND length(regexp_replace(coalesce(p2.invoice_number, ''), '[^0-9]', '', 'g')) >= 6
          AND lower(coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '')) ~ ('(^|[^0-9])' || regexp_replace(coalesce(p2.invoice_number, ''), '[^0-9]', '', 'g') || '([^0-9]|$)'))
      AND EXISTS (
        SELECT 1 FROM public.suppliers s
        WHERE s.company_id = bt.company_id AND COALESCE(s.is_utility, false) = true
          AND public.supplier_confirmed_in_text_strict(s.name, COALESCE(s.vat_number, s.partita_iva), coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '')))
    RETURNING bt.id
  )
  SELECT count(*) INTO v_n FROM upd;
  RETURN jsonb_build_object('chiusi_utenze', v_n);
END;
$function$;

DROP FUNCTION IF EXISTS public.invoice_cited_in_text(text, text, int);
DROP FUNCTION IF EXISTS public.invoice_number_keys(text);
