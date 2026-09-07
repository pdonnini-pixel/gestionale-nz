-- =============================================================================
-- Il match sui flussi CBI anonimi accettava scadenze troppo lontane nel futuro
-- Applicato su NZ + Made + Zago il 04/09/2026.
-- =============================================================================
--
-- `try_match_amount_bank_transaction` serve ai movimenti la cui causale non nomina
-- nessuno («VOSTRA DISPOSIZIONE A FAVORE DI N.D.») ma porta scritto l'IMPORTO
-- BONIFICI del flusso CBI. Se una sola scadenza aperta ha quell'importo netto al
-- centesimo, la aggancia. È un compromesso ragionevole, ma la finestra delle date
-- era aperta solo in avanti: bastava che il movimento fosse successivo alla data
-- fattura e precedente alla scadenza più 180 giorni.
--
-- Così il 04/09 un bonifico del 06/03/2026 si è agganciato a una fattura GRUPPO
-- SERVIZI ASSOCIATI in scadenza il 31/07/2026: un pagamento quasi cinque mesi
-- PRIMA della sua scadenza, che nessuno fa.
--
-- Si aggiunge il limite che mancava: il movimento non può precedere la scadenza
-- di più di 30 giorni. Trenta e non zero perché un pagamento anticipato di qualche
-- settimana capita davvero (chiusura anticipata di fine mese, richiesta del
-- fornitore); cinque mesi no.
--
-- Il caso simmetrico resta coperto: SPM INVESTIGAZIONI, movimento del 09/03 su
-- scadenza 26/02, cioè undici giorni di ritardo, continua ad agganciarsi. È
-- esattamente il caso per cui questa funzione esiste.
--
-- Il corpo della funzione è invariato rispetto alla versione precedente tranne
-- la riga del nuovo limite inferiore, aggiunta in fondo alla WHERE dei candidati.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.try_match_amount_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD;
  v_descr TEXT;
  v_net NUMERIC := NULL;
  v_named BOOLEAN := false;
  v_n INT := 0;
  v_n_disp INT := 0;
  v_ids uuid[];
  v_disp_id uuid;
  v_only RECORD;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing');
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;

  v_descr := coalesce(v_bt.description, '');
  v_net := public.bank_movement_net(v_descr);
  IF v_net IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'no_structured_net');
  END IF;

  v_named := public.causale_has_named_beneficiary(v_descr);

  WITH cand AS (
    SELECT p.id,
           public.payable_in_distinta_for_movement(p.id, v_bt.bank_account_id, v_bt.transaction_date) AS in_disp
    FROM public.payables p
    WHERE p.company_id = v_bt.company_id
      AND p.bank_transaction_id IS NULL
      AND p.gross_amount > 0
      AND COALESCE(p.is_placeholder, false) = false
      AND ( p.status IN ('da_pagare', 'in_scadenza', 'scaduto')
            OR (p.status = 'pagato' AND COALESCE(p.closed_manually, false)) )
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = p.id AND l.status = 'pending')
      AND abs(p.gross_amount - v_net) <= 0.02
      AND ( NOT v_named
            OR public.supplier_confirmed_in_text(p.supplier_name, p.supplier_vat, v_descr) )
      AND (p.invoice_date IS NULL OR v_bt.transaction_date >= p.invoice_date)
      AND v_bt.transaction_date
            <= COALESCE(p.due_date, p.invoice_date, v_bt.transaction_date) + INTERVAL '180 days'
      -- Un pagamento non precede la propria scadenza di mesi: al massimo qualche
      -- settimana. Senza questo limite un bonifico di marzo chiudeva una scadenza
      -- di luglio (caso GRUPPO SERVIZI ASSOCIATI del 04/09/2026).
      AND v_bt.transaction_date
            >= COALESCE(p.due_date, p.invoice_date, v_bt.transaction_date) - INTERVAL '30 days'
  )
  SELECT count(*), count(*) FILTER (WHERE in_disp),
         array_agg(id), (array_agg(id) FILTER (WHERE in_disp))[1]
    INTO v_n, v_n_disp, v_ids, v_disp_id
  FROM cand;

  IF v_n = 0 THEN
    RETURN jsonb_build_object('matched', false);
  END IF;

  IF v_n = 1 THEN
    SELECT * INTO v_only FROM public.payables WHERE id = v_ids[1];
  ELSIF v_n_disp = 1 THEN
    SELECT * INTO v_only FROM public.payables WHERE id = v_disp_id;
  ELSE
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
    SELECT v_bt.company_id, p_bt_id, p.id, 'auto_fuzzy', 60, 'to_confirm', p.gross_amount,
           'proposta: IMPORTO BONIFICI netto esatto (flusso CBI anonimo) — piu'' candidati, conferma manuale'
    FROM public.payables p WHERE p.id = ANY(v_ids);
    RETURN jsonb_build_object('matched', false, 'proposed', v_n, 'reason', 'ambiguous_proposed');
  END IF;

  IF v_only.status = 'pagato' AND COALESCE(v_only.closed_manually, false) THEN
    UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_only.id;
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
    VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 95, 'applied', v_only.gross_amount,
            'auto: IMPORTO BONIFICI netto esatto e univoco (flusso CBI anonimo) — chiusa a mano, solo aggancio');
  ELSE
    UPDATE public.payables
    SET amount_paid = v_only.gross_amount,
        amount_remaining = 0,
        status = 'pagato'::payable_status,
        payment_date = v_bt.transaction_date,
        bank_transaction_id = p_bt_id,
        updated_at = now()
    WHERE id = v_only.id;
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
    VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 90, 'applied', v_only.gross_amount,
            'auto: IMPORTO BONIFICI netto esatto e univoco (flusso CBI anonimo)');
  END IF;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_only.id
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('matched', true, 'auto', true, 'payable_id', v_only.id, 'net', v_net,
                            'disambiguated_by_distinta', (v_n > 1));
END;
$function$;
