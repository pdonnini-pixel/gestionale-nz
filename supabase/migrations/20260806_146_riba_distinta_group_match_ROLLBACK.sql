-- ============================================================================
-- ROLLBACK 20260806_146_riba_distinta_group_match.sql
-- Ripristina la conferma a SINGOLA scadenza (versione 145) e rimuove quella a
-- gruppo. NON riapre le scadenze gia' confermate. Le colonne aggiunte restano
-- (non distruttivo); rimozione manuale opzionale in fondo.
--
-- Per ripristinare integralmente automatch/confirm della 145, ri-applicare il
-- file supabase/migrations/20260806_145_riba_distinta_upload.sql (sezioni 6-8).
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_confirm_riba_distinta_line(uuid, uuid[]);

-- Ripristina la conferma a singola scadenza (firma 145)
CREATE OR REPLACE FUNCTION public.rpc_confirm_riba_distinta_line(p_line_id uuid, p_payable_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_company uuid; v_role text; v_line RECORD; v_pay RECORD;
BEGIN
  SELECT company_id, role INTO v_company, v_role FROM public.user_profiles WHERE id = auth.uid();
  IF COALESCE(v_role,'') NOT IN ('super_advisor','contabile') THEN
    RAISE EXCEPTION 'Non autorizzato: serve il ruolo contabile o super_advisor';
  END IF;
  SELECT * INTO v_line FROM public.riba_distinta_lines WHERE id = p_line_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Riga distinta non trovata o non accessibile'; END IF;
  SELECT * INTO v_pay FROM public.payables WHERE id = p_payable_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scadenza non trovata o non accessibile'; END IF;
  IF v_line.raw_amount IS NULL OR round(v_pay.gross_amount * 100)::bigint <> round(v_line.raw_amount * 100)::bigint THEN
    RAISE EXCEPTION 'IMPORTO_NON_QUADRA: distinta % vs dovuto %', v_line.raw_amount, v_pay.gross_amount;
  END IF;
  IF NOT public.fn_payable_is_riba(p_payable_id) THEN
    RAISE EXCEPTION 'NON_RIBA: la scadenza non e'' a ricevuta bancaria';
  END IF;
  IF v_pay.bank_transaction_id IS NULL THEN
    UPDATE public.payables SET amount_paid = gross_amount, payment_date = COALESCE(payment_date, v_line.raw_due_date, due_date),
      is_provisional_paid = false,
      payment_bank_account_id = COALESCE(payment_bank_account_id, (SELECT bank_account_id FROM public.riba_distinte WHERE id = v_line.distinta_id))
    WHERE id = p_payable_id;
    INSERT INTO public.payable_actions (payable_id, action_type, amount, note, performed_at)
    VALUES (p_payable_id, 'conferma_distinta_riba', v_pay.gross_amount, 'Confermata da distinta RiBa (riscontro importo al centesimo)', now());
  END IF;
  UPDATE public.riba_distinta_lines SET matched_payable_id = p_payable_id, match_status = 'confirmed' WHERE id = p_line_id;
  RETURN jsonb_build_object('ok', true, 'payable_id', p_payable_id, 'amount', v_pay.gross_amount);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_confirm_riba_distinta_line(uuid, uuid) TO authenticated;

COMMIT;

-- Colonne aggiunte (non distruttivo). Per rimuoverle:
-- ALTER TABLE public.riba_distinta_lines DROP COLUMN IF EXISTS matched_payable_ids;
-- ALTER TABLE public.riba_distinta_lines DROP COLUMN IF EXISTS matched_supplier_id;
-- ALTER TABLE public.riba_distinta_lines DROP COLUMN IF EXISTS raw_vat;
