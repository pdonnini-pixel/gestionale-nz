-- ROLLBACK della migrazione 364: ripristina la 362 (gruppo per nome con chiusura
-- automatica nel giro notturno). Nessun dato toccato. NZ + Zago.

BEGIN;

CREATE OR REPLACE FUNCTION public.try_match_group_name_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD; v_descr TEXT; v_mov NUMERIC; v_grp RECORD; v_pay RECORD;
  v_first UUID := NULL; v_linked INT := 0; v_applied NUMERIC;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing'); END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled'); END IF;
  IF public.fn_bank_own_movement(v_bt.description) THEN RETURN jsonb_build_object('matched', false, 'reason', 'movimento_della_banca'); END IF;

  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' '
                   || coalesce(v_bt.merchant_name, '') || ' ' || coalesce(v_bt.statement_description, ''));
  v_mov := abs(v_bt.amount);

  -- Per ogni fornitore nominato in causale: tutte le sue scadenze aperte fino a
  -- 15 giorni dopo il bonifico. Vale solo il gruppo che fa esattamente l'importo.
  SELECT g.k, g.ids, g.tot, g.n, g.sup, count(*) OVER () AS n_grp INTO v_grp
  FROM (
    SELECT COALESCE(p.supplier_vat, p.supplier_name) AS k, array_agg(p.id) AS ids,
           sum(p.amount_remaining) AS tot, count(*) AS n, max(p.supplier_name) AS sup
    FROM public.payables p
    WHERE p.company_id = v_bt.company_id
      AND p.bank_transaction_id IS NULL
      AND p.gross_amount > 0
      AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto')
      AND p.amount_remaining > 0
      AND p.invoice_date IS NOT NULL
      AND p.invoice_date <= v_bt.transaction_date + 15
      AND p.supplier_name IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.payable_credit_note_links l
                      WHERE l.payable_id = p.id AND l.status = 'pending')
      AND public.supplier_confirmed_in_text(p.supplier_name, p.supplier_vat, v_descr)
    GROUP BY COALESCE(p.supplier_vat, p.supplier_name)
    HAVING count(*) >= 2 AND abs(sum(p.amount_remaining) - v_mov) <= 0.02
  ) g
  LIMIT 1;

  IF NOT FOUND OR v_grp.n_grp <> 1 THEN
    RETURN jsonb_build_object('matched', false, 'gruppi', CASE WHEN FOUND THEN v_grp.n_grp ELSE 0 END);
  END IF;

  -- Il no di una persona vale piu' della regola.
  IF EXISTS (SELECT 1 FROM public.reconciliation_log l
             WHERE l.bank_transaction_id = p_bt_id AND l.payable_id = ANY(v_grp.ids) AND l.status = 'rejected') THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'gia_rifiutata');
  END IF;

  FOR v_pay IN SELECT * FROM public.payables WHERE id = ANY(v_grp.ids) ORDER BY invoice_date, invoice_number LOOP
    IF v_first IS NULL THEN v_first := v_pay.id; END IF;
    v_applied := v_pay.amount_remaining;
    UPDATE public.payables
       SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
           payment_date = v_bt.transaction_date,
           bank_transaction_id = p_bt_id,
           updated_at = now()
     WHERE id = v_pay.id;
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
    VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_applied,
            'auto: fornitore in causale, tutte le sue scadenze aperte fanno l''importo (migration 362)');
    v_linked := v_linked + 1;
  END LOOP;

  UPDATE public.bank_transactions
     SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first
   WHERE id = p_bt_id;

  RETURN jsonb_build_object('matched', true, 'auto', true, 'grouped', true, 'linked', v_linked,
                            'supplier', v_grp.sup, 'sum', v_grp.tot, 'movimento', v_mov);
END;
$function$;

REVOKE ALL ON FUNCTION public.try_match_group_name_bank_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_match_group_name_bank_transaction(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rerun_group_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE r RECORD; v_proc INT := 0; v_match INT := 0; v_linked INT := 0; v_res jsonb;
BEGIN
  FOR r IN SELECT id FROM public.bank_transactions WHERE amount < 0 AND status IN ('posted', 'booked') AND COALESCE(is_reconciled, false) = false LOOP
    v_proc := v_proc + 1;
    v_res := public.try_match_group_bank_transaction(r.id);
    IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN v_res := public.try_match_group_numbers_bank_transaction(r.id); END IF;
    -- 362: fornitore in causale e somma esatta di tutte le sue scadenze aperte.
    IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN v_res := public.try_match_group_name_bank_transaction(r.id); END IF;
    IF COALESCE((v_res->>'matched')::boolean, false) THEN v_match := v_match + 1; v_linked := v_linked + COALESCE((v_res->>'linked')::int, 0); END IF;
  END LOOP;
  RETURN jsonb_build_object('processed', v_proc, 'matched', v_match, 'fatture_agganciate', v_linked);
END;
$function$;

COMMIT;
