-- Rollback della 440: torna la funzione della 438 (finestra solo sulla scadenza).

BEGIN;

CREATE OR REPLACE FUNCTION public.try_match_sdd_commission_bank_transaction(p_bt_id uuid, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD;
  v_c text;
  v_n int;
  v_keys int;
  v_pid uuid;
  v_res jsonb;
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 OR COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_applicable');
  END IF;
  v_c := upper(COALESCE(NULLIF(v_bt.statement_description, ''), v_bt.description, ''));
  IF v_c !~ 'ADDEBITO SDD' THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_sdd');
  END IF;

  WITH cand AS (
    SELECT p.id, p.due_date, COALESCE(p.amount_remaining, p.gross_amount - COALESCE(p.amount_paid, 0)) AS rem,
           COALESCE(NULLIF(p.supplier_vat, ''), upper(p.supplier_name)) AS sk
    FROM public.payables p
    WHERE p.company_id = v_bt.company_id
      AND p.bank_transaction_id IS NULL
      AND p.gross_amount > 0
      AND COALESCE(p.is_placeholder, false) = false
      AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto')
      AND abs(COALESCE(p.amount_remaining, p.gross_amount - COALESCE(p.amount_paid, 0)) - (abs(v_bt.amount) - 1.00)) < 0.005
      AND (p.invoice_date IS NULL OR p.invoice_date <= v_bt.transaction_date)
      AND p.due_date BETWEEN v_bt.transaction_date - 30 AND v_bt.transaction_date + 15
      AND (public.supplier_confirmed_in_text(p.supplier_name, p.supplier_vat, v_c)
           OR (length(split_part(regexp_replace(COALESCE(p.supplier_name, ''), '[^A-Za-z0-9 ]', '', 'g'), ' ', 1)) >= 3
               AND v_c ~ ('(^|[^A-Z0-9])' || split_part(upper(regexp_replace(COALESCE(p.supplier_name, ''), '[^A-Za-z0-9 ]', '', 'g')), ' ', 1) || '([^A-Z0-9]|$)')))
  )
  SELECT count(*), count(DISTINCT (sk, rem, due_date)), (array_agg(id ORDER BY due_date, id))[1]
    INTO v_n, v_keys, v_pid FROM cand;

  IF v_n = 0 OR v_keys <> 1 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'none_or_ambiguous', 'candidati', v_n);
  END IF;
  IF p_dry_run THEN
    RETURN jsonb_build_object('matched', true, 'dry_run', true, 'payable_id', v_pid, 'candidati', v_n);
  END IF;

  v_res := public.reconcile_movement(p_bt_id, v_pid);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'refused', 'detail', v_res);
  END IF;
  UPDATE public.reconciliation_log
     SET match_type = 'auto_exact',
         notes = 'auto (438): addebito SDD = fattura + 1,00 di commissione MPS — ' || COALESCE(notes, '')
   WHERE bank_transaction_id = p_bt_id AND payable_id = v_pid AND status = 'applied' AND match_type = 'manual';
  RETURN jsonb_build_object('matched', true, 'auto', true, 'linked', 1, 'payable_id', v_pid, 'by', 'sdd_commissione');
END;
$function$;
REVOKE ALL ON FUNCTION public.try_match_sdd_commission_bank_transaction(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_match_sdd_commission_bank_transaction(uuid, boolean) TO authenticated, service_role;

COMMIT;
