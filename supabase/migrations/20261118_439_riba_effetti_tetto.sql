-- 439 — Revisione della 438 (revisore-database, 18/11/2026). NZ + Zago. Solo la funzione RiBa.
-- * Tetto: con più di 25 candidati non si cerca (la CTE ricorsiva su n fino a 12 poteva esplodere e far
--   scadere il timeout di tutto run_daily_reconciliation). La ricerca si ferma alla seconda soluzione.
-- * Candidati: fattura non successiva all'addebito; fuori le fatture con note di credito in sospeso.
-- * Come la distinta (347): le proposte «to_confirm» sullo stesso movimento passano a «rejected»; confirmed_at.
-- Nessun dato toccato. Rollback: rimette la funzione della 438.

CREATE OR REPLACE FUNCTION public.try_match_riba_effetti_bank_transaction(p_bt_id uuid, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD;
  v_c text;
  v_n int;
  v_target numeric;
  v_sol int;
  v_ids uuid[];
  v_pay RECORD;
  v_note text;
  v_first uuid;
  v_ncand int;
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 OR COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_applicable');
  END IF;
  v_c := upper(COALESCE(NULLIF(v_bt.statement_description, ''), v_bt.description, ''));
  IF v_c !~ 'EFFETTI RITIRATI' OR v_c ~ 'CRED:' THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_anonymous_riba');
  END IF;
  v_n := (regexp_match(v_c, 'NUM\.?\s*EFFETTI:?\s*0*([0-9]+)'))[1]::int;
  IF v_n IS NULL OR v_n < 1 OR v_n > 12 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'num_effetti');
  END IF;
  v_target := abs(v_bt.amount) - v_n * 0.40;

  -- 439: tetto ai candidati, la ricerca delle combinazioni resta piccola.
  SELECT count(*) INTO v_ncand FROM public.payables p
  WHERE p.company_id = v_bt.company_id AND p.bank_transaction_id IS NULL AND p.gross_amount > 0
    AND COALESCE(p.is_placeholder, false) = false
    AND ((p.status = 'pagato' AND COALESCE(p.is_provisional_paid, false)) OR p.status IN ('da_pagare', 'in_scadenza', 'scaduto'))
    AND p.due_date BETWEEN v_bt.transaction_date - 5 AND v_bt.transaction_date;
  IF v_ncand > 25 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'troppi_candidati', 'candidati', v_ncand);
  END IF;

  WITH RECURSIVE cand AS (
    SELECT row_number() OVER (ORDER BY p.id) AS rn, p.id,
           CASE WHEN COALESCE(p.is_provisional_paid, false) THEN p.gross_amount
                ELSE COALESCE(p.amount_remaining, p.gross_amount - COALESCE(p.amount_paid, 0)) END AS amt
    FROM public.payables p
    WHERE p.company_id = v_bt.company_id
      AND p.bank_transaction_id IS NULL
      AND p.gross_amount > 0
      AND COALESCE(p.is_placeholder, false) = false
      AND ((p.status = 'pagato' AND COALESCE(p.is_provisional_paid, false))
           OR p.status IN ('da_pagare', 'in_scadenza', 'scaduto'))
      AND p.due_date BETWEEN v_bt.transaction_date - 5 AND v_bt.transaction_date
      AND (p.invoice_date IS NULL OR p.invoice_date <= v_bt.transaction_date)
      AND NOT EXISTS (SELECT 1 FROM public.payable_credit_note_links l
                      WHERE l.payable_id = p.id AND l.status = 'pending')
  ), s(last_rn, n, tot, ids) AS (
    SELECT rn, 1, amt, ARRAY[id] FROM cand WHERE amt <= v_target + 0.005
    UNION ALL
    SELECT c.rn, s.n + 1, s.tot + c.amt, s.ids || c.id
    FROM s JOIN cand c ON c.rn > s.last_rn
    WHERE s.n < v_n AND s.tot + c.amt <= v_target + 0.005
  ), sol AS (SELECT ids FROM s WHERE n = v_n AND abs(tot - v_target) < 0.005 LIMIT 2)  -- 439: ci si ferma alla seconda
  SELECT count(*), (SELECT ids FROM sol LIMIT 1) INTO v_sol, v_ids FROM sol;

  IF COALESCE(v_sol, 0) <> 1 OR v_ids IS NULL OR array_length(v_ids, 1) <> v_n THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'none_or_ambiguous', 'soluzioni', v_sol);
  END IF;
  IF p_dry_run THEN
    RETURN jsonb_build_object('matched', true, 'dry_run', true, 'payable_ids', to_jsonb(v_ids), 'effetti', v_n);
  END IF;

  v_note := to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY') || ': pagata con RiBa, addebito MPS «effetti ritirati» del '
            || to_char(v_bt.transaction_date, 'DD/MM/YYYY') || ' (' || v_n || ' effetti più 0,40 di commissione ciascuno, migration 438)';
  FOR v_pay IN SELECT * FROM public.payables WHERE id = ANY (v_ids) ORDER BY id LOOP
    IF v_first IS NULL THEN v_first := v_pay.id; END IF;
    UPDATE public.payables SET
      amount_paid = GREATEST(COALESCE(amount_paid, 0), gross_amount),
      payment_date = COALESCE(CASE WHEN COALESCE(v_pay.is_provisional_paid, false) THEN v_pay.payment_date END, LEAST(v_pay.due_date, v_bt.transaction_date)),
      is_provisional_paid = false,
      bank_transaction_id = p_bt_id,
      notes = CASE WHEN COALESCE(btrim(notes), '') = '' THEN v_note ELSE notes || E'\n' || v_note END,
      updated_at = now()
    WHERE id = v_pay.id;
    INSERT INTO public.payable_actions (payable_id, action_type, old_status, new_status, amount, note)
    SELECT v_pay.id, 'conferma_effetti_ritirati', v_pay.status, py.status, py.gross_amount, v_note FROM public.payables py WHERE py.id = v_pay.id;
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, linked_only, notes, confirmed_at)
    VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 95, 'applied',
            CASE WHEN COALESCE(v_pay.is_provisional_paid, false) THEN v_pay.gross_amount
                 ELSE COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0)) END,
            COALESCE(v_pay.is_provisional_paid, false),
            'auto (438): effetti ritirati MPS, somma degli effetti + 0,40 ciascuno = addebito, unica combinazione', now());
  END LOOP;
  -- 439: le proposte ancora da confermare su questo movimento non servono più (come la distinta, 347).
  UPDATE public.reconciliation_log SET status = 'rejected',
         notes = COALESCE(notes, '') || ' | superata il ' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY') || ': effetti ritirati abbinati (439)'
   WHERE bank_transaction_id = p_bt_id AND status = 'to_confirm';
  UPDATE public.bank_transactions SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first WHERE id = p_bt_id;
  RETURN jsonb_build_object('matched', true, 'auto', true, 'linked', array_length(v_ids, 1), 'by', 'riba_effetti');
END;
$function$;

