-- ============================================================================
-- ROLLBACK 20260807_148_riba_distinta_net_of_credit_notes.sql
-- Ripristina la conferma riga distinta SENZA gestione delle note di credito
-- (versione della migration 146: solo fatture, somma == importo). NON riapre
-- le scadenze/NC gia' confermate.
-- Per ripristinare: ri-applicare la sezione "rpc_confirm_riba_distinta_line"
-- di supabase/migrations/20260806_146_riba_distinta_group_match.sql.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_confirm_riba_distinta_line(p_line_id uuid, p_payable_ids uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid; v_role text; v_line RECORD; v_sum numeric; v_cnt integer; v_bad integer; v_pid uuid; v_bank uuid;
BEGIN
  SELECT company_id, role INTO v_company, v_role FROM public.user_profiles WHERE id = auth.uid();
  IF COALESCE(v_role,'') NOT IN ('super_advisor','contabile') THEN
    RAISE EXCEPTION 'Non autorizzato: serve il ruolo contabile o super_advisor';
  END IF;
  SELECT * INTO v_line FROM public.riba_distinta_lines WHERE id = p_line_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Riga distinta non trovata o non accessibile'; END IF;
  IF p_payable_ids IS NULL OR array_length(p_payable_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Nessuna scadenza selezionata';
  END IF;
  SELECT count(*), coalesce(sum(gross_amount),0), count(*) FILTER (WHERE NOT public.fn_payable_is_riba(id))
    INTO v_cnt, v_sum, v_bad
  FROM public.payables WHERE id = ANY(p_payable_ids) AND company_id = v_company;
  IF v_cnt <> array_length(p_payable_ids, 1) THEN RAISE EXCEPTION 'Scadenze non trovate o di altra azienda'; END IF;
  IF v_bad > 0 THEN RAISE EXCEPTION 'NON_RIBA: una o piu'' scadenze non sono a ricevuta bancaria'; END IF;
  IF v_line.raw_amount IS NULL OR round(v_sum * 100)::bigint <> round(v_line.raw_amount * 100)::bigint THEN
    RAISE EXCEPTION 'IMPORTO_NON_QUADRA: somma % vs distinta %', v_sum, v_line.raw_amount;
  END IF;
  v_bank := (SELECT bank_account_id FROM public.riba_distinte WHERE id = v_line.distinta_id);
  FOREACH v_pid IN ARRAY p_payable_ids LOOP
    UPDATE public.payables p
    SET amount_paid = p.gross_amount, payment_date = COALESCE(p.payment_date, v_line.raw_due_date, p.due_date),
        is_provisional_paid = false, payment_bank_account_id = COALESCE(p.payment_bank_account_id, v_bank)
    WHERE p.id = v_pid AND p.bank_transaction_id IS NULL;
    INSERT INTO public.payable_actions (payable_id, action_type, amount, note, performed_at)
    VALUES (v_pid, 'conferma_distinta_riba', (SELECT gross_amount FROM public.payables WHERE id = v_pid),
            'Confermata da distinta RiBa (riscontro importo al centesimo)', now());
  END LOOP;
  UPDATE public.riba_distinta_lines SET matched_payable_ids = p_payable_ids, matched_payable_id = p_payable_ids[1], match_status = 'confirmed' WHERE id = p_line_id;
  RETURN jsonb_build_object('ok', true, 'count', v_cnt, 'total', v_sum);
END;
$function$;

COMMIT;
