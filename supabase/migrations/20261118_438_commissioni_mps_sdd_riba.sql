-- 438 — Motore: addebiti SDD e RiBa MPS con la commissione della banca dentro l'importo. NZ + Zago.
--
-- Il fatto (Zago, 18/11/2026). 1) MPS addebita ogni SDD con 1,00 di commissione: NEXI 25,62 esce come
-- 26,62, Amazon 13,20 come 14,20, Global Blue 61,00 come 62,00. Nessuna regola li abbinava (importo
-- diverso) e le fatture restavano «addebito automatico» aperte. Su NZ 5 casi così erano stati agganciati
-- solo perché la fattura risultava già pagata. 2) L'addebito «EFFETTI RITIRATI (PAGATI) NUM.EFFETTI: n»
-- non dice i fornitori e vale la somma degli effetti più 0,40 per effetto. Le RiBa restavano «pagato
-- provvisorio» finché non arriva la distinta; tre fatture GLS pagate con RiBa restavano «scadute».
-- Misura delle commissioni: SDD 1,00 su Zago (NEXI, Amazon, Global Blue) e sui 5 casi NZ; RiBa 0,40 per
-- effetto su NZ in tutti gli addebiti con un effetto per fattura (10 su 10) e su Zago (31/08, 30/09, 02/11).
--
-- Regole (solo con un'unica soluzione possibile, altrimenti non si fa niente):
--  * SDD (try_match_sdd_commission_bank_transaction): causale «ADDEBITO SDD» che nomina il fornitore;
--    fattura aperta senza movimento, residuo = addebito - 1,00 (al centesimo), scadenza fra 30 giorni
--    prima e 15 dopo l'addebito, fattura non successiva. Più candidati vanno bene solo se sono
--    intercambiabili (stesso fornitore, importo e scadenza: le due NEXI dello stesso giorno).
--    L'aggancio lo fa reconcile_movement (stessa scrittura dell'abbinamento a mano).
--  * RiBa (try_match_riba_effetti_bank_transaction): causale «EFFETTI RITIRATI» con NUM.EFFETTI e senza
--    «CRED:» (quelle col creditore le prende già il motore). Candidati: RiBa in «pagato provvisorio» e
--    fatture aperte, senza movimento, con scadenza nei 5 giorni prima dell'addebito. Deve esistere
--    UN SOLO insieme di n documenti la cui somma + n × 0,40 dà l'addebito al centesimo.
--    Scrittura come la distinta RiBa (347): pagato pieno, is_provisional_paid = false, movimento collegato,
--    nota datata, payable_actions e reconciliation_log.
-- Nuovo passaggio nel giro notturno dopo i cumulativi: rerun_commissioni_mps_reconciliation.
-- p_dry_run = true: dice cosa farebbe senza scrivere niente.

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
  ), s(last_rn, n, tot, ids) AS (
    SELECT rn, 1, amt, ARRAY[id] FROM cand WHERE amt <= v_target + 0.005
    UNION ALL
    SELECT c.rn, s.n + 1, s.tot + c.amt, s.ids || c.id
    FROM s JOIN cand c ON c.rn > s.last_rn
    WHERE s.n < v_n AND s.tot + c.amt <= v_target + 0.005
  )
  SELECT count(*) OVER (), ids INTO v_sol, v_ids
  FROM s WHERE n = v_n AND abs(tot - v_target) < 0.005
  LIMIT 1;

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
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, linked_only, notes)
    VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 95, 'applied',
            CASE WHEN COALESCE(v_pay.is_provisional_paid, false) THEN v_pay.gross_amount
                 ELSE COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0)) END,
            COALESCE(v_pay.is_provisional_paid, false),
            'auto (438): effetti ritirati MPS, somma degli effetti + 0,40 ciascuno = addebito, unica combinazione');
  END LOOP;
  UPDATE public.bank_transactions SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first WHERE id = p_bt_id;
  RETURN jsonb_build_object('matched', true, 'auto', true, 'linked', array_length(v_ids, 1), 'by', 'riba_effetti');
END;
$function$;
REVOKE ALL ON FUNCTION public.try_match_riba_effetti_bank_transaction(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_match_riba_effetti_bank_transaction(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rerun_commissioni_mps_reconciliation(p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  r RECORD;
  v_res jsonb;
  v_sdd int := 0;
  v_riba int := 0;
  v_docs int := 0;
  v_out jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  PERFORM public.richiedi_profilo_gestionale(); -- migration 364
  FOR r IN
    SELECT id, transaction_date, amount FROM public.bank_transactions
    WHERE amount < 0 AND status IN ('posted', 'booked') AND COALESCE(is_reconciled, false) = false
    ORDER BY transaction_date, id
  LOOP
    v_res := public.try_match_sdd_commission_bank_transaction(r.id, p_dry_run);
    IF COALESCE((v_res->>'matched')::boolean, false) THEN
      v_sdd := v_sdd + 1; v_docs := v_docs + 1;
      IF p_dry_run THEN v_out := v_out || jsonb_build_object('data', r.transaction_date, 'importo', r.amount, 'esito', v_res); END IF;
      CONTINUE;
    END IF;
    v_res := public.try_match_riba_effetti_bank_transaction(r.id, p_dry_run);
    IF COALESCE((v_res->>'matched')::boolean, false) THEN
      v_riba := v_riba + 1;
      v_docs := v_docs + CASE WHEN jsonb_typeof(v_res->'payable_ids') = 'array' THEN jsonb_array_length(v_res->'payable_ids')
                              ELSE COALESCE((v_res->>'linked')::int, 0) END;
      IF p_dry_run THEN v_out := v_out || jsonb_build_object('data', r.transaction_date, 'importo', r.amount, 'esito', v_res); END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('sdd', v_sdd, 'riba', v_riba, 'documenti', v_docs, 'dry_run', p_dry_run, 'dettaglio', v_out);
END;
$function$;
REVOKE ALL ON FUNCTION public.rerun_commissioni_mps_reconciliation(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rerun_commissioni_mps_reconciliation(boolean) TO authenticated, service_role;

-- Il passaggio nel giro notturno, dopo i cumulativi.
CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_disp jsonb; v_group jsonb; v_cum jsonb; v_comm jsonb; v_bij jsonb; v_amt jsonb; v_close jsonb;
  v_util jsonb; v_riba jsonb; v_cash jsonb; v_fisc jsonb; v_cat jsonb;
  v_t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  PERFORM public.richiedi_profilo_gestionale(); -- migration 364
  SET LOCAL statement_timeout = '20min';

  v_disp := public.rerun_distinta_reconciliation();
  v_group := public.rerun_group_reconciliation();
  v_cum := public.rerun_cumulative_reconciliation();
  v_comm := public.rerun_commissioni_mps_reconciliation(false) - 'dettaglio'; -- 438
  v_bij := public.rerun_bijective_reconciliation();
  v_amt := public.rerun_amount_reconciliation();
  v_close := public.close_non_supplier_movements();
  v_util := public.close_utility_movements();
  v_riba := public.rerun_riba_provisional_close();
  v_cash := public.rerun_cash_card_provisional_close();
  v_fisc := public.close_paid_fiscal_deadlines();
  v_cat := public.clean_bank_category_conflicts();

  RETURN jsonb_build_object('distinte', v_disp, 'granitici', v_group, 'cumulativi', v_cum,
                            'commissioni_mps', v_comm,
                            'biettivo', v_bij,
                            'importo_anonimo', v_amt, 'chiusi_non_fornitore', v_close,
                            'chiusi_utenze', v_util, 'riba_provvisorie', v_riba,
                            'contanti_carte_provvisorie', v_cash,
                            'scadenze_fiscali', v_fisc, 'etichette', v_cat,
                            'run_at', now(),
                            'durata_sec', round(extract(epoch from (clock_timestamp() - v_t0))::numeric, 1));
END;
$function$;
