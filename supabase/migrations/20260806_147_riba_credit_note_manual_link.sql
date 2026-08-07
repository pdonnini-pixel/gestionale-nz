-- ============================================================================
-- 20260806_147_riba_credit_note_manual_link.sql
-- FASE 3 — RiBa: note di credito ABBINATE A MANO a una scadenza/pagamento
-- ----------------------------------------------------------------------------
-- Regola (Patrizio): le note di credito dei fornitori a RICEVUTA BANCARIA NON
-- vanno mai compensate in automatico; vanno messe a disposizione dell'operatrice
-- (Sabrina/Lilian/Patrizio) per ABBINARLE a un determinato pagamento/scadenza, e
-- tutto deve restare tracciato nel partitario del fornitore.
--
-- Modello: riuso di payable_credit_note_links (payable_id = la scadenza/pagamento
-- destinazione, credit_note_payable_id = la NC). L'abbinamento CHIUDE la NC a mano
-- (closed_manually, registrata in AVERE nel partitario) e la collega alla scadenza
-- scelta. Nessuna compensazione automatica altrove. Reversibile.
--
-- Additiva. Applicare su NZ + Made + Zago.
-- ============================================================================

BEGIN;

-- Abbina una NOTA DI CREDITO a una scadenza RiBa dello STESSO fornitore.
CREATE OR REPLACE FUNCTION public.rpc_link_riba_credit_note(p_credit_note_id uuid, p_target_payable_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid; v_role text; v_nc RECORD; v_tgt RECORD; v_amt numeric; v_ref text;
BEGIN
  SELECT company_id, role INTO v_company, v_role FROM public.user_profiles WHERE id = auth.uid();
  IF COALESCE(v_role,'') NOT IN ('super_advisor','contabile') THEN
    RAISE EXCEPTION 'Non autorizzato: serve il ruolo contabile o super_advisor';
  END IF;

  SELECT * INTO v_nc FROM public.payables WHERE id = p_credit_note_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota di credito non trovata o non accessibile'; END IF;
  IF NOT (v_nc.status = 'nota_credito' OR v_nc.gross_amount < 0) THEN
    RAISE EXCEPTION 'La riga selezionata non e'' una nota di credito';
  END IF;
  IF COALESCE(v_nc.closed_manually, false) THEN
    RAISE EXCEPTION 'Nota di credito gia'' chiusa/abbinata';
  END IF;

  SELECT * INTO v_tgt FROM public.payables WHERE id = p_target_payable_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scadenza di destinazione non trovata'; END IF;

  -- stesso fornitore (per supplier_id oppure per P.IVA)
  IF v_nc.supplier_id IS DISTINCT FROM v_tgt.supplier_id
     AND COALESCE(v_nc.supplier_vat,'') IS DISTINCT FROM COALESCE(v_tgt.supplier_vat,'') THEN
    RAISE EXCEPTION 'La nota di credito e la scadenza sono di fornitori diversi';
  END IF;

  v_amt := abs(v_nc.gross_amount);
  v_ref := COALESCE(v_tgt.invoice_number, '');

  INSERT INTO public.payable_credit_note_links
    (company_id, payable_id, credit_note_payable_id, amount, status, created_by, applied_at)
  VALUES (v_company, p_target_payable_id, p_credit_note_id, v_amt, 'applied', auth.uid(), now())
  ON CONFLICT (payable_id, credit_note_payable_id)
    DO UPDATE SET status = 'applied', amount = v_amt, applied_at = now();

  -- chiudi la NC a mano (registrata in AVERE nel partitario), con riferimento alla scadenza
  UPDATE public.payables
    SET closed_manually = true,
        payment_date = COALESCE(v_tgt.payment_date, CURRENT_DATE),
        manual_close_reason = 'Abbinata a scadenza RiBa ' || v_ref
    WHERE id = p_credit_note_id;

  INSERT INTO public.payable_actions (payable_id, action_type, amount, note, performed_at)
  VALUES (p_credit_note_id, 'abbinamento_nc_riba', v_amt,
          'Nota di credito abbinata alla scadenza RiBa ' || v_ref || ' (registrata in AVERE)', now());

  RETURN jsonb_build_object('ok', true, 'amount', v_amt, 'target', p_target_payable_id);
END;
$function$;

-- Annulla l'abbinamento: riapre la NC e marca il link come cancelled.
CREATE OR REPLACE FUNCTION public.rpc_unlink_riba_credit_note(p_credit_note_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_company uuid; v_role text; v_nc RECORD;
BEGIN
  SELECT company_id, role INTO v_company, v_role FROM public.user_profiles WHERE id = auth.uid();
  IF COALESCE(v_role,'') NOT IN ('super_advisor','contabile') THEN
    RAISE EXCEPTION 'Non autorizzato: serve il ruolo contabile o super_advisor';
  END IF;
  SELECT * INTO v_nc FROM public.payables WHERE id = p_credit_note_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota di credito non trovata o non accessibile'; END IF;
  IF NOT (v_nc.status = 'nota_credito' OR v_nc.gross_amount < 0) THEN
    RAISE EXCEPTION 'La riga selezionata non e'' una nota di credito';
  END IF;

  UPDATE public.payables
    SET closed_manually = false, payment_date = NULL, manual_close_reason = NULL
    WHERE id = p_credit_note_id;

  UPDATE public.payable_credit_note_links
    SET status = 'cancelled'
    WHERE credit_note_payable_id = p_credit_note_id AND status = 'applied';

  INSERT INTO public.payable_actions (payable_id, action_type, amount, note, performed_at)
  VALUES (p_credit_note_id, 'riapertura_nc_riba', abs(v_nc.gross_amount),
          'Abbinamento nota di credito RiBa annullato (riaperta)', now());

  RETURN jsonb_build_object('ok', true, 'credit_note_id', p_credit_note_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_link_riba_credit_note(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_unlink_riba_credit_note(uuid) TO authenticated;

COMMIT;
