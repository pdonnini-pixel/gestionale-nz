-- 20260911_211 — Il match per importo guarda il RESIDUO, non il totale della fattura.
--
-- PERCHÉ (Patrizio, 11/09/2026: «c'era qualcosa da chiudere dalle distinte o dalla
-- riconciliazione?»). Sì, e il motore non poteva vederlo. WOLF GROUP fattura 218: totale
-- 79.683,24, acconto di 39.683,24 già pagato ad agosto, residuo 40.000,00 esatti. Il
-- 03/09 la distinta dispone proprio 40.000,00; il 04/09 esce dal conto un flusso CBI con
-- netto 40.000,00. Nessuno li ha messi insieme: 40.001,75 € fermi in riconciliazione.
--
-- Due motivi, entrambi qui dentro:
--   1. il confronto usava p.gross_amount, cioè il TOTALE della fattura. Su una fattura
--      pagata in due tranche il totale non coincide mai col bonifico del saldo: coincide
--      il residuo. Ora si confronta amount_remaining.
--   2. la fattura era esclusa da `bank_transaction_id IS NULL`, perché quel campo era già
--      occupato dal movimento dell'acconto. Una fattura ha un solo campo per il movimento,
--      ma può avere più pagamenti: per le PARZIALI il vincolo non si applica.
--
-- Acconto più saldo è pratica normale coi fornitori grossi (su NZ: WOLF, GGZ), quindi il
-- caso si ripresenterà. Sui dati di oggi la modifica non produce nuovi agganci — l'unico
-- caso aperto è stato chiuso a mano prima di scrivere questa migration — ma d'ora in poi
-- lo riconosce da sola.
--
-- Le tutele restano tutte: importo esatto (±0,02), candidato UNICO (altrimenti proposta da
-- confermare, mai aggancio d'ufficio), movimento mai precedente alla fattura, finestra da
-- -30 a +180 giorni sulla scadenza, fornitore confermato quando la causale lo nomina.
--
-- Nessun dato cancellato. Rollback in _ROLLBACK.sql

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
  v_residuo NUMERIC;
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
      AND p.gross_amount > 0
      AND COALESCE(p.is_placeholder, false) = false
      -- R2: una fattura senza aggancio bancario è sempre abbinabile, aperta o pagata.
      -- In più le PARZIALI, che hanno il campo del movimento già occupato dall'acconto:
      -- lì il saldo è un secondo pagamento sulla stessa fattura.
      AND ( ( p.bank_transaction_id IS NULL
              AND ( p.status IN ('da_pagare', 'in_scadenza', 'scaduto')
                    OR ( p.status = 'pagato'
                         AND COALESCE(p.payment_method::text, '')
                               NOT IN ('contanti', 'carta_credito', 'carta_debito') ) ) )
            OR p.status = 'parziale' )
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = p.id AND l.status = 'pending')
      -- Si confronta il RESIDUO: su una fattura con acconto il bonifico del saldo
      -- non coincide mai col totale.
      AND abs(COALESCE(p.amount_remaining,
                       p.gross_amount - COALESCE(p.amount_paid, 0),
                       p.gross_amount) - v_net) <= 0.02
      AND ( NOT v_named
            OR public.supplier_confirmed_in_text(p.supplier_name, p.supplier_vat, v_descr) )
      AND (p.invoice_date IS NULL OR v_bt.transaction_date >= p.invoice_date)
      AND v_bt.transaction_date
            <= COALESCE(p.due_date, p.invoice_date, v_bt.transaction_date) + INTERVAL '180 days'
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

  -- Fattura già pagata: si collega il movimento e basta. Importi, stato e data di
  -- pagamento restano quelli che sono: la contabilità l'ha già registrata.
  IF v_only.status = 'pagato' THEN
    UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_only.id;
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
    VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 95, 'applied', v_only.gross_amount,
            'auto: IMPORTO BONIFICI netto esatto e univoco (flusso CBI anonimo) — fattura gia'' pagata, solo aggancio');
  ELSE
    -- Aperta o parziale: si somma il pagamento a quanto già versato, così l'acconto
    -- precedente non viene cancellato.
    v_residuo := COALESCE(v_only.amount_remaining,
                          v_only.gross_amount - COALESCE(v_only.amount_paid, 0),
                          v_only.gross_amount);
    UPDATE public.payables
    SET amount_paid = COALESCE(amount_paid, 0) + v_residuo,
        payment_date = v_bt.transaction_date,
        bank_transaction_id = p_bt_id,
        updated_at = now()
    WHERE id = v_only.id;
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
    VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 90, 'applied', v_residuo,
            'auto: IMPORTO BONIFICI netto esatto e univoco (flusso CBI anonimo)'
            || CASE WHEN v_only.status::text = 'parziale' THEN ' — saldo dopo acconto' ELSE '' END);
  END IF;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_only.id
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('matched', true, 'auto', true, 'payable_id', v_only.id, 'net', v_net,
                            'disambiguated_by_distinta', (v_n > 1));
END;
$function$;

REVOKE ALL ON FUNCTION public.try_match_amount_bank_transaction(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_match_amount_bank_transaction(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.try_match_amount_bank_transaction(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.try_match_amount_bank_transaction(uuid) TO service_role;
