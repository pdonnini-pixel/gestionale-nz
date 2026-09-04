-- =============================================================================
-- Migrazione 176 — Guardia "non si paga una fattura che non esiste ancora"
-- =============================================================================
--
-- CASO REALE (NZ, segnalato 04/09/2026)
--   Scadenza EPPI S.R.L. fattura 32 del 03/08/2026, scad. 30/09/2026, 3.050,00 €
--   risultava "Pagato" da un movimento MPS del 03/06/2026 (3.051,75 € lordi =
--   3.050,00 netti + 1,75 di commissioni). Due mesi PRIMA che la fattura esistesse.
--
--   Colpevole: try_match_amount_bank_transaction (motore v3, migration 164).
--   Il cron del 04/08 alle 05:45 ha ripreso il movimento del 03/06 rimasto orfano,
--   ha letto "IMPORTO BONIFICI: 3.050,00" dalla causale CBI anonima e ha trovato
--   una sola scadenza aperta con quell'importo esatto: la 32, emessa il giorno prima.
--   Match "auto_exact", chiusura immediata. EPPI fattura 3.050 € ogni mese: l'importo
--   da solo non distingue nulla, e la finestra date lo lasciava passare.
--
--   La finestra della v3 era:
--     transaction_date BETWEEN COALESCE(invoice_date, due_date) - 120 giorni
--                          AND COALESCE(due_date, invoice_date) + 180 giorni
--   Il +180 serviva ai pagamenti in ritardo (DWS 26VAL-0526, giusto). Il -120 invece
--   ammetteva pagamenti fino a quattro mesi PRIMA dell'emissione: fisicamente impossibile.
--
-- LA REGOLA (già scritta nella migration 117 per il solo matcher biettivo)
--   Un movimento bancario non può pagare una fattura emessa DOPO di lui.
--   La 117 l'aveva applicata a rerun_bijective_reconciliation con 15 giorni di
--   tolleranza; gli altri due matcher a legame debole erano rimasti scoperti.
--   Qui la regola diventa uniforme e senza tolleranza (scelta operativa 04/09/2026):
--   transaction_date >= invoice_date, sempre.
--
-- DOVE SI APPLICA
--   * try_match_amount_bank_transaction — flussi CBI anonimi, legame = solo importo.
--   * try_match_bank_transaction        — a punteggio, l'importo può pesare da solo.
--   * rerun_bijective_reconciliation    — da -15 giorni a 0.
--   NON si applica ai granitici a nome (102/111) e a numeri (120): lì la causale cita
--   il numero della fattura, che è prova diretta che la fattura esisteva già.
--
--   Quando invoice_date è NULL la guardia non scatta (non sappiamo quando è nata la
--   fattura); nel biettivo resta in quel caso la vecchia finestra a -15 giorni sulla
--   data disponibile, così la migration non allarga nulla rispetto a oggi.
--
-- ATTENZIONE — pagare prima della SCADENZA resta normale e ammesso.
--   La guardia guarda invoice_date, mai due_date.
--
-- SICUREZZA: solo CREATE OR REPLACE di funzioni. Nessun dato toccato, nessuna colonna
-- rimossa. Rollback in _ROLLBACK.sql (ripristina le versioni 164/117).
-- ⚠️ NZ + Made + Zago.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) try_match_amount_bank_transaction — v4: niente pagamenti ante-fattura
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- 2) try_match_bank_transaction — v5: stessa guardia nel pool candidati
-- -----------------------------------------------------------------------------
-- Identica alla v4 della migration 164, con una sola riga in più nel WHERE del
-- loop: una scadenza emessa dopo il movimento non entra nemmeno in classifica.
CREATE OR REPLACE FUNCTION public.try_match_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD;
  v_pay RECORD;
  v_best_payable_id UUID;
  v_best_score NUMERIC := 0;
  v_best_amount NUMERIC := 0;
  v_best_name NUMERIC := 0;
  v_best_date NUMERIC := 0;
  v_best_is_closed BOOLEAN := false;
  v_best_identity BOOLEAN := false;
  v_pay_is_closed BOOLEAN;
  v_score_amount NUMERIC;
  v_score_name NUMERIC;
  v_score_date NUMERIC;
  v_score_invoice NUMERIC;
  v_score_disp NUMERIC;
  v_score_total NUMERIC;
  v_bank_bonus NUMERIC;
  v_amount_diff_pct NUMERIC;
  v_days_diff INTEGER;
  v_match_type TEXT;
  v_log_status TEXT;
  v_descr TEXT;
  v_name_in_descr BOOLEAN;
  v_inv_hit BOOLEAN;
  v_disp_hit BOOLEAN;
  v_identity BOOLEAN;
  v_mov NUMERIC;
  v_net NUMERIC;
  v_cmp NUMERIC;
  v_key_len INTEGER;
  v_ties INTEGER := 0;
  -- v4: memoria del miglior candidato per il pari merito tra rate della stessa fattura
  v_best_due_date DATE;
  v_best_installment INTEGER;
  v_best_invoice TEXT;
  v_best_supplier_key TEXT;
  v_best_gap INTEGER;
  v_gap INTEGER;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'amount_not_negative_or_tx_not_found');
  END IF;

  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_reconciled');
  END IF;

  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));
  v_mov := abs(v_bt.amount);
  v_net := public.bank_movement_net(v_bt.description);

  FOR v_pay IN
    SELECT *,
           (status = 'pagato') AS is_closed_manual
    FROM public.payables
    WHERE company_id = v_bt.company_id
      AND bank_transaction_id IS NULL
      AND gross_amount > 0
      AND status IN ('da_pagare', 'in_scadenza', 'scaduto', 'pagato')
      AND (payables.invoice_date IS NULL OR payables.invoice_date <= v_bt.transaction_date)
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = payables.id AND l.status = 'pending'
      )
  LOOP
    v_pay_is_closed := COALESCE(v_pay.is_closed_manual, false);

    v_cmp := v_mov;
    IF v_net IS NOT NULL AND abs(v_net - v_pay.gross_amount) <= 0.02 THEN
      v_cmp := v_pay.gross_amount;
    ELSIF v_mov > v_pay.gross_amount
          AND (v_mov - v_pay.gross_amount) <= LEAST(5.00, GREATEST(0.50, v_pay.gross_amount * 0.002)) THEN
      v_cmp := v_pay.gross_amount;
    END IF;

    v_amount_diff_pct := abs(v_cmp - v_pay.gross_amount) / v_pay.gross_amount * 100;
    v_score_amount := GREATEST(0, 50 - v_amount_diff_pct * 5);

    v_score_name := 0;
    v_name_in_descr := false;
    IF v_pay.supplier_vat IS NOT NULL AND v_descr LIKE '%' || lower(v_pay.supplier_vat) || '%' THEN
      v_score_name := 30;
      v_name_in_descr := true;
    ELSIF v_pay.supplier_name IS NOT NULL AND v_descr LIKE '%' || lower(v_pay.supplier_name) || '%' THEN
      v_score_name := 25;
      v_name_in_descr := true;
    ELSIF v_pay.supplier_name IS NOT NULL THEN
      v_score_name := similarity(v_descr, lower(v_pay.supplier_name)) * 30;
      IF public.supplier_confirmed_in_text(v_pay.supplier_name, v_pay.supplier_vat, v_descr) THEN
        v_name_in_descr := true;
      END IF;
    END IF;

    IF v_pay.due_date IS NULL THEN
      v_score_date := 0;
    ELSE
      v_days_diff := abs(v_bt.transaction_date - v_pay.due_date);
      v_score_date := GREATEST(0, 20 - v_days_diff);
    END IF;

    v_bank_bonus := 0;
    IF v_pay.payment_bank_account_id IS NOT NULL
       AND v_pay.payment_bank_account_id = v_bt.bank_account_id THEN
      v_bank_bonus := 10;
    END IF;

    v_disp_hit := public.payable_in_distinta_for_movement(v_pay.id, v_bt.bank_account_id, v_bt.transaction_date);
    v_score_disp := CASE WHEN v_disp_hit THEN 25 ELSE 0 END;

    v_score_invoice := 0;
    v_inv_hit := false;
    SELECT max(length(k)) INTO v_key_len
    FROM unnest(public.invoice_number_keys(v_pay.invoice_number)) k
    WHERE length(k) >= 2
      AND v_descr ~ ('(^|[^0-9])' || k || '([^0-9]|$)');

    IF v_key_len IS NOT NULL THEN
      IF v_key_len >= 5 THEN
        v_inv_hit := true;
        v_score_invoice := CASE WHEN v_amount_diff_pct <= 2 THEN 45 ELSE 15 END;
      ELSIF v_key_len >= 3 AND v_amount_diff_pct <= 2 AND (v_name_in_descr OR v_disp_hit) THEN
        v_inv_hit := true;
        v_score_invoice := 45;
      ELSIF v_amount_diff_pct <= 2 AND v_name_in_descr THEN
        v_inv_hit := true;
        v_score_invoice := 45;
      END IF;
    END IF;

    v_identity := v_name_in_descr OR v_inv_hit OR v_disp_hit;

    IF v_pay_is_closed AND (NOT v_identity OR v_amount_diff_pct > 5) THEN
      CONTINUE;
    END IF;

    -- v4: il punteggio di CLASSIFICA non e' piu' tappato a 100. Il tetto resta solo
    -- sulla confidence scritta nel log. Caso DWS 26VAL-0987, PAYMENT_PLAN_NOTES.md.
    v_score_total := v_score_amount + v_score_name + v_score_date + v_bank_bonus + v_score_invoice + v_score_disp;
    v_gap := CASE WHEN v_pay.due_date IS NULL THEN NULL ELSE abs(v_bt.transaction_date - v_pay.due_date) END;

    IF v_score_total > v_best_score THEN
      v_best_score := v_score_total;
      v_best_payable_id := v_pay.id;
      v_best_amount := v_score_amount;
      v_best_name := v_score_name;
      v_best_date := v_score_date;
      v_best_is_closed := v_pay_is_closed;
      v_best_identity := v_identity;
      v_best_due_date := v_pay.due_date;
      v_best_installment := v_pay.installment_number;
      v_best_invoice := v_pay.invoice_number;
      v_best_supplier_key := COALESCE(v_pay.supplier_vat, v_pay.supplier_id::text, v_pay.supplier_name);
      v_best_gap := v_gap;
      v_ties := 1;
    ELSIF v_score_total = v_best_score AND v_score_total > 0 THEN
      IF v_pay.invoice_number IS NOT NULL
         AND v_pay.invoice_number = v_best_invoice
         AND COALESCE(v_pay.supplier_vat, v_pay.supplier_id::text, v_pay.supplier_name) IS NOT DISTINCT FROM v_best_supplier_key THEN
        -- Rate della STESSA fattura a pari punteggio: vince la scadenza piu' vicina
        -- alla data del movimento e, a pari distanza, la rata con il numero piu' basso.
        IF (v_gap IS NOT NULL AND (v_best_gap IS NULL OR v_gap < v_best_gap))
           OR (v_gap IS NOT DISTINCT FROM v_best_gap
               AND COALESCE(v_pay.installment_number, 0) < COALESCE(v_best_installment, 0)) THEN
          v_best_payable_id := v_pay.id;
          v_best_amount := v_score_amount;
          v_best_name := v_score_name;
          v_best_date := v_score_date;
          v_best_is_closed := v_pay_is_closed;
          v_best_identity := v_identity;
          v_best_due_date := v_pay.due_date;
          v_best_installment := v_pay.installment_number;
          v_best_gap := v_gap;
        END IF;
      ELSE
        -- Pari merito tra fatture DIVERSE: indistinguibili per il motore.
        v_ties := v_ties + 1;
      END IF;
    END IF;
  END LOOP;

  IF v_best_payable_id IS NULL OR v_best_score < 50 THEN
    RETURN jsonb_build_object('matched', false, 'best_score', v_best_score);
  END IF;

  IF v_best_score >= 80 AND NOT v_best_is_closed AND v_best_identity AND v_ties = 1 THEN
    v_match_type := 'auto_exact';
    v_log_status := 'applied';
  ELSE
    v_match_type := 'auto_fuzzy';
    v_log_status := 'to_confirm';
  END IF;

  INSERT INTO public.reconciliation_log (
    company_id, bank_transaction_id, payable_id, match_type, confidence,
    score_amount, score_name, score_date, status, notes
  ) VALUES (
    v_bt.company_id, p_bt_id, v_best_payable_id, v_match_type, LEAST(100, v_best_score),
    v_best_amount, v_best_name, v_best_date, v_log_status,
    CASE
      WHEN v_best_is_closed THEN 'auto-generated: fattura gia'' pagata — conferma aggancio movimento'
      WHEN NOT v_best_identity THEN 'auto-generated: solo importo/data/banca, beneficiario non confermato — serve conferma'
      WHEN v_ties > 1 THEN 'auto-generated: ' || v_ties || ' scadenze a pari punteggio, il motore non puo'' scegliere — serve conferma'
      ELSE 'auto-generated by try_match_bank_transaction v5'
    END
  );

  IF v_match_type = 'auto_exact' THEN
    UPDATE public.payables
    SET bank_transaction_id = p_bt_id,
        status = 'pagato'::payable_status,
        amount_paid = gross_amount,
        amount_remaining = 0,
        payment_date = v_bt.transaction_date,
        updated_at = now()
    WHERE id = v_best_payable_id;

    UPDATE public.bank_transactions
    SET is_reconciled = true,
        reconciled_at = now(),
        reconciled_invoice_id = v_best_payable_id
    WHERE id = p_bt_id;
  END IF;

  RETURN jsonb_build_object(
    'matched', true,
    'payable_id', v_best_payable_id,
    'score', LEAST(100, v_best_score),
    'match_type', v_match_type,
    'closed_manual', v_best_is_closed,
    'identity', v_best_identity,
    'applied', v_match_type = 'auto_exact'
  );
END;
$function$;

-- -----------------------------------------------------------------------------
-- 3) rerun_bijective_reconciliation — la tolleranza di 15 giorni scende a 0
-- -----------------------------------------------------------------------------
-- La 117 ammetteva 15 giorni di anticipo sulla data fattura. Con invoice_date nota
-- la guardia diventa secca; senza invoice_date resta la vecchia finestra a -15
-- giorni sulla data disponibile, per non allargare il comportamento attuale.
CREATE OR REPLACE FUNCTION public.rerun_bijective_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_pay RECORD;
  v_bt RECORD;
  v_applied NUMERIC;
  v_pairs INT := 0;
  v_inv_date DATE;
  v_floor DATE;
BEGIN
  FOR v_pay IN
    SELECT * FROM public.payables
    WHERE bank_transaction_id IS NULL
      AND gross_amount > 0
      AND supplier_name IS NOT NULL
      AND status IN ('da_pagare', 'in_scadenza', 'scaduto', 'pagato')
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = payables.id AND l.status = 'pending')
    ORDER BY company_id, supplier_name, gross_amount,
             COALESCE(invoice_date, due_date, created_at::date)
  LOOP
    v_inv_date := COALESCE(v_pay.invoice_date, v_pay.due_date, v_pay.created_at::date);
    v_floor := COALESCE(v_pay.invoice_date, v_inv_date - INTERVAL '15 days');

    SELECT bt.* INTO v_bt
    FROM public.bank_transactions bt
    WHERE bt.company_id = v_pay.company_id
      AND bt.amount < 0
      AND COALESCE(bt.is_reconciled, false) = false
      AND bt.status IN ('posted', 'booked')
      AND abs(abs(bt.amount) - v_pay.gross_amount) <= GREATEST(0.02, v_pay.gross_amount * 0.01)
      AND bt.transaction_date >= v_floor
      AND public.supplier_confirmed_in_text(
            v_pay.supplier_name, v_pay.supplier_vat,
            coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '') || ' ' || coalesce(bt.merchant_name, ''))
    ORDER BY abs(bt.transaction_date - v_inv_date) ASC, bt.transaction_date DESC
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_pay.status = 'pagato' THEN
      UPDATE public.payables SET bank_transaction_id = v_bt.id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_pay.company_id, v_bt.id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount,
              'auto: abbinamento per data — stesso fornitore/importo (già pagata)');
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables
      SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
          payment_date = v_bt.transaction_date,
          bank_transaction_id = v_bt.id,
          updated_at = now()
      WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_pay.company_id, v_bt.id, v_pay.id, 'auto_exact', 100, 'applied', v_applied,
              'auto: abbinamento per data — stesso fornitore/importo');
    END IF;

    UPDATE public.bank_transactions
    SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_pay.id
    WHERE id = v_bt.id;

    v_pairs := v_pairs + 1;
  END LOOP;

  RETURN jsonb_build_object('coppie_abbinate', v_pairs);
END;
$function$;

COMMIT;

-- =============================================================================
-- VERIFICA (da eseguire su ciascun tenant dopo l'applicazione)
-- =============================================================================
-- 1) Nessun matcher ammette più l'anticipo sulla data fattura:
--    SELECT proname,
--           pg_get_functiondef(oid) LIKE '%120 days%' AS ha_ancora_120gg
--    FROM pg_proc WHERE proname IN ('try_match_amount_bank_transaction',
--                                   'try_match_bank_transaction',
--                                   'rerun_bijective_reconciliation');
--    -> ha_ancora_120gg deve essere false ovunque.
--
-- 2) Fotografia degli agganci impossibili ancora presenti (dato storico, non toccato
--    da questa migration — la bonifica è separata):
--    SELECT count(*) FROM payables p
--    JOIN bank_transactions bt ON bt.id = p.bank_transaction_id
--    WHERE bt.transaction_date < p.invoice_date;
-- =============================================================================
