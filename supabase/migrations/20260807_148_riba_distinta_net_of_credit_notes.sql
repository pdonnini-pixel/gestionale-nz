-- ============================================================================
-- 20260807_148_riba_distinta_net_of_credit_notes.sql
-- FASE 2.2 — RiBa distinta: effetti AL NETTO delle note di credito
-- ----------------------------------------------------------------------------
-- Sui PDF reali (distinta MPS) molti effetti sono al NETTO di note di credito:
--   "ACCONTO FATT 3657 MENO NC 3797"     -> 3.205,34 − 2.914,90 = 290,44
--   "ACC FATT 3480 MENO NC 3438 N.3439"  -> 4.053,45 − 1.134,60 − 1.220,00 = 1.698,85
--   "SALDO FT 560 A 801 - NC 44-56"      -> somma fatture − somma NC
--
-- Percio' la conferma di una riga distinta accetta un MIX di scadenze:
--   - fatture (gross_amount > 0)  -> chiuse come pagate via distinta
--   - note di credito (gross < 0) -> chiuse a mano (AVERE nel partitario) e
--     collegate alla fattura del gruppo (payable_credit_note_links = applied)
-- Il GATE resta AL CENTESIMO: sum(gross_amount) di tutte le selezionate (le NC
-- pesano negative) deve coincidere con l'importo dell'effetto. Niente a fiducia.
--
-- Vincoli: tutte le scadenze dello STESSO fornitore, almeno UNA fattura.
-- Additiva. Applicare su NZ + Made + Zago.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_confirm_riba_distinta_line(p_line_id uuid, p_payable_ids uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid; v_role text; v_line RECORD;
  v_cnt integer; v_sum numeric; v_bad integer; v_pos integer; v_neg integer; v_sup_distinct integer;
  v_first_pos uuid; v_bank uuid; v_pid uuid; v_gross numeric;
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

  SELECT count(*), coalesce(sum(gross_amount),0),
         count(*) FILTER (WHERE NOT public.fn_payable_is_riba(id)),
         count(*) FILTER (WHERE gross_amount > 0),
         count(*) FILTER (WHERE gross_amount < 0),
         count(DISTINCT supplier_id)
    INTO v_cnt, v_sum, v_bad, v_pos, v_neg, v_sup_distinct
  FROM public.payables WHERE id = ANY(p_payable_ids) AND company_id = v_company;

  IF v_cnt <> array_length(p_payable_ids, 1) THEN RAISE EXCEPTION 'Scadenze non trovate o di altra azienda'; END IF;
  IF v_bad > 0 THEN RAISE EXCEPTION 'NON_RIBA: una o piu'' scadenze non sono a ricevuta bancaria'; END IF;
  IF v_pos = 0 THEN RAISE EXCEPTION 'Serve almeno una fattura nella composizione dell''effetto'; END IF;
  IF v_sup_distinct > 1 THEN RAISE EXCEPTION 'Le scadenze selezionate sono di fornitori diversi'; END IF;

  -- GATE AL CENTESIMO: netto (fatture − NC) == importo effetto
  IF v_line.raw_amount IS NULL OR round(v_sum * 100)::bigint <> round(v_line.raw_amount * 100)::bigint THEN
    RAISE EXCEPTION 'IMPORTO_NON_QUADRA: netto % vs distinta %', v_sum, v_line.raw_amount;
  END IF;

  v_bank := (SELECT bank_account_id FROM public.riba_distinte WHERE id = v_line.distinta_id);
  -- fattura rappresentativa (la piu' grande) a cui collegare le NC del gruppo
  SELECT id INTO v_first_pos FROM public.payables
    WHERE id = ANY(p_payable_ids) AND gross_amount > 0 ORDER BY gross_amount DESC LIMIT 1;

  FOREACH v_pid IN ARRAY p_payable_ids LOOP
    SELECT gross_amount INTO v_gross FROM public.payables WHERE id = v_pid;
    IF v_gross > 0 THEN
      -- FATTURA: chiusa come pagata via distinta
      UPDATE public.payables p
      SET amount_paid = p.gross_amount,
          payment_date = COALESCE(p.payment_date, v_line.raw_due_date, p.due_date),
          is_provisional_paid = false,
          payment_bank_account_id = COALESCE(p.payment_bank_account_id, v_bank)
      WHERE p.id = v_pid AND p.bank_transaction_id IS NULL;
      INSERT INTO public.payable_actions (payable_id, action_type, amount, note, performed_at)
      VALUES (v_pid, 'conferma_distinta_riba', v_gross,
              'Confermata da distinta RiBa (riscontro netto al centesimo)', now());
    ELSE
      -- NOTA DI CREDITO: chiusa a mano (AVERE) + collegata alla fattura del gruppo
      UPDATE public.payables
      SET closed_manually = true,
          payment_date = COALESCE(v_line.raw_due_date, CURRENT_DATE),
          manual_close_reason = 'Compensata nella distinta RiBa'
      WHERE id = v_pid;
      INSERT INTO public.payable_credit_note_links
        (company_id, payable_id, credit_note_payable_id, amount, status, created_by, applied_at)
      VALUES (v_company, v_first_pos, v_pid, abs(v_gross), 'applied', auth.uid(), now())
      ON CONFLICT (payable_id, credit_note_payable_id)
        DO UPDATE SET status = 'applied', amount = abs(v_gross), applied_at = now();
      INSERT INTO public.payable_actions (payable_id, action_type, amount, note, performed_at)
      VALUES (v_pid, 'abbinamento_nc_riba', abs(v_gross),
              'Nota di credito compensata nella distinta RiBa (registrata in AVERE)', now());
    END IF;
  END LOOP;

  UPDATE public.riba_distinta_lines
    SET matched_payable_ids = p_payable_ids, matched_payable_id = v_first_pos, match_status = 'confirmed'
    WHERE id = p_line_id;

  RETURN jsonb_build_object('ok', true, 'count', v_cnt, 'fatture', v_pos, 'note_credito', v_neg, 'netto', v_sum);
END;
$function$;

COMMIT;
