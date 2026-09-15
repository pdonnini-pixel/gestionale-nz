-- =====================================================================
-- Migrazione 116 — I matcher AUTOMATICI includono le fatture "pagato senza aggancio"
-- =====================================================================
-- REGOLA R2 (Patrizio): una fattura senza bank_transaction_id è SEMPRE abbinabile,
-- a prescindere dallo stato. Finora era vera solo nelle RPC di aggancio manuale
-- (reconcile_movement / _group, migr. 114), ma NON nei matcher AUTOMATICI
-- (granitico, a punteggio, biettivo), che nel pool candidati includevano solo le
-- fatture aperte + quelle chiuse a mano — NON le "pagato" lisce senza aggancio
-- (segnate pagate all'import/go-live / off-system).
--
-- CASO REALE (New Zago): fattura SAN MAURO SPA 26-0564 (3.714,57), status 'pagato',
-- closed_manually=false, senza movimento. L'addebito SDD del 12/06 cita in causale
-- "A FAVORE SAN MAURO SPA … Fattura … 26-0564" con importo esatto: il granitico
-- l'avrebbe agganciata, ma la fattura non era nel pool → non si chiudeva da sola.
--
-- FIX: i tre matcher includono nel pool anche `status='pagato' AND
-- bank_transaction_id IS NULL` (già pagata → SOLO aggancio, nessuna doppia scrittura),
-- non solo le closed_manually. Nessun'altra logica cambia (conferma fornitore stretta,
-- numeri, tolleranze restano). Additiva/idempotente. Reversibile (undo_reconcile_movement).
-- ⚠️ REGOLA #0 — NZ + Made + Zago.
-- Dopo l'apply, per lo storico:  SELECT public.rerun_group_reconciliation();
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) GRANITICO di gruppo
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_match_group_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bt RECORD;
  v_descr TEXT;
  v_mov NUMERIC;
  v_grp RECORD;
  v_pay RECORD;
  v_first UUID := NULL;
  v_linked INT := 0;
  v_applied NUMERIC;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing');
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;

  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));
  v_mov := abs(v_bt.amount);

  SELECT g.supplier_name, g.ids, g.tot INTO v_grp
  FROM (
    SELECT q.supplier_name, array_agg(q.id) AS ids, sum(q.amt) AS tot
    FROM (
      SELECT p.id, p.supplier_name,
        CASE WHEN p.status = 'pagato' THEN p.gross_amount
             ELSE COALESCE(p.amount_remaining, p.gross_amount - COALESCE(p.amount_paid, 0), p.gross_amount) END AS amt
      FROM public.payables p
      WHERE p.company_id = v_bt.company_id
        AND p.bank_transaction_id IS NULL
        AND p.gross_amount > 0
        AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto', 'pagato')  -- R2: incluse le pagato senza aggancio
        AND public.supplier_confirmed_in_text(p.supplier_name, p.supplier_vat, v_descr)
        AND (
          ( length(ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0')) >= 4
            AND v_descr ~ ('(^|[^0-9])' || ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0') || '([^0-9]|$)') )
          OR
          ( length(ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0')) BETWEEN 2 AND 3
            AND v_descr ~ '(saldo|fattura|fatt|nota|parcella)'
            AND v_descr ~ ('(^|[^0-9])' || ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0') || '([^0-9]|$)') )
          OR
          -- numero ALFANUMERICO con separatori (es. "26-0564", "FI 000458", "B0202600536"):
          -- match come token isolato tollerando i separatori (come il matcher a punteggio).
          ( length(regexp_replace(lower(coalesce(p.invoice_number, '')), '[^a-z0-9]', '', 'g')) >= 4
            AND v_descr ~ ('(^|[^a-z0-9])' || regexp_replace(lower(trim(coalesce(p.invoice_number, ''))), '[^a-z0-9]+', '[^a-z0-9]{0,3}', 'g') || '([^a-z0-9]|$)') )
        )
    ) q
    GROUP BY q.supplier_name
    HAVING abs(sum(q.amt) - v_mov) <= GREATEST(0.02, v_mov * 0.01)
    ORDER BY count(*) DESC
    LIMIT 1
  ) g;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false);
  END IF;

  FOR v_pay IN SELECT * FROM public.payables WHERE id = ANY(v_grp.ids) LOOP
    IF v_first IS NULL THEN v_first := v_pay.id; END IF;

    IF v_pay.status = 'pagato' AND v_pay.bank_transaction_id IS NULL THEN  -- R2: già pagata → solo aggancio
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount,
              'auto: fattura citata in causale (già pagata — solo aggancio)');
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables
      SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
          payment_date = v_bt.transaction_date,
          bank_transaction_id = p_bt_id,
          updated_at = now()
      WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_applied,
              'auto: fattura citata in causale (importo esatto)');
    END IF;
    v_linked := v_linked + 1;
  END LOOP;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('matched', true, 'auto', true, 'grouped', (v_linked > 1),
                            'linked', v_linked, 'supplier', v_grp.supplier_name, 'sum', v_grp.tot, 'movimento', v_mov);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.try_match_group_bank_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_match_group_bank_transaction(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2) BIETTIVO per data
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rerun_bijective_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pay RECORD;
  v_bt RECORD;
  v_applied NUMERIC;
  v_pairs INT := 0;
  v_inv_date DATE;
BEGIN
  FOR v_pay IN
    SELECT * FROM public.payables
    WHERE bank_transaction_id IS NULL
      AND gross_amount > 0
      AND supplier_name IS NOT NULL
      AND status IN ('da_pagare', 'in_scadenza', 'scaduto', 'pagato')  -- R2: incluse le pagato senza aggancio
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = payables.id AND l.status = 'pending')
    ORDER BY company_id, supplier_name, gross_amount,
             COALESCE(invoice_date, due_date, created_at::date)
  LOOP
    v_inv_date := COALESCE(v_pay.invoice_date, v_pay.due_date, v_pay.created_at::date);

    SELECT bt.* INTO v_bt
    FROM public.bank_transactions bt
    WHERE bt.company_id = v_pay.company_id
      AND bt.amount < 0
      AND COALESCE(bt.is_reconciled, false) = false
      AND bt.status IN ('posted', 'booked')
      AND abs(abs(bt.amount) - v_pay.gross_amount) <= GREATEST(0.02, v_pay.gross_amount * 0.01)
      AND public.supplier_confirmed_in_text(
            v_pay.supplier_name, v_pay.supplier_vat,
            coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '') || ' ' || coalesce(bt.merchant_name, ''))
    ORDER BY abs(bt.transaction_date - v_inv_date) ASC, bt.transaction_date DESC
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_pay.status = 'pagato' THEN  -- R2: già pagata → solo aggancio
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

REVOKE EXECUTE ON FUNCTION public.rerun_bijective_reconciliation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rerun_bijective_reconciliation() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3) A PUNTEGGIO — pool include le pagato senza aggancio; il gate "già pagata"
--    (mai solo-importo) si applica a tutte le pagato, non solo alle chiuse a mano.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_match_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  v_pay_is_closed BOOLEAN;
  v_score_amount NUMERIC;
  v_score_name NUMERIC;
  v_score_date NUMERIC;
  v_score_invoice NUMERIC;
  v_score_total NUMERIC;
  v_bank_bonus NUMERIC;
  v_amount_diff_pct NUMERIC;
  v_days_diff INTEGER;
  v_match_type TEXT;
  v_log_status TEXT;
  v_descr TEXT;
  v_name_in_descr BOOLEAN;
  v_inv_hit BOOLEAN;
  v_inv_norm TEXT;
  v_inv_re TEXT;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'amount_not_negative_or_tx_not_found');
  END IF;

  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_reconciled');
  END IF;

  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));

  FOR v_pay IN
    SELECT *,
           (status = 'pagato') AS is_closed_manual  -- R2: "già pagata" = qualsiasi pagato senza aggancio
    FROM public.payables
    WHERE company_id = v_bt.company_id
      AND bank_transaction_id IS NULL
      AND gross_amount > 0
      AND status IN ('da_pagare', 'in_scadenza', 'scaduto', 'pagato')  -- R2
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = payables.id AND l.status = 'pending'
      )
  LOOP
    v_pay_is_closed := COALESCE(v_pay.is_closed_manual, false);

    v_amount_diff_pct := abs(abs(v_bt.amount) - v_pay.gross_amount) / v_pay.gross_amount * 100;
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

    v_score_invoice := 0;
    v_inv_hit := false;
    v_inv_norm := regexp_replace(lower(coalesce(v_pay.invoice_number, '')), '[^a-z0-9]', '', 'g');
    IF length(v_inv_norm) >= 2 THEN
      v_inv_re := '(^|[^a-z0-9])'
                  || regexp_replace(lower(trim(v_pay.invoice_number)), '[^a-z0-9]+', '[^a-z0-9]{0,3}', 'g')
                  || '([^a-z0-9]|$)';
      IF v_descr ~ v_inv_re THEN
        IF length(v_inv_norm) >= 5 THEN
          v_inv_hit := true;
          v_score_invoice := CASE WHEN v_amount_diff_pct <= 2 THEN 45 ELSE 15 END;
        ELSIF v_amount_diff_pct <= 2 AND v_name_in_descr THEN
          v_inv_hit := true;
          v_score_invoice := 45;
        END IF;
      END IF;
    END IF;

    -- Gate per le fatture GIÀ PAGATE (chiuse a mano o pagato senza aggancio): mai
    -- solo-importo. Serve fornitore confermato OPPURE numero fattura, importo <= 5%.
    IF v_pay_is_closed AND (NOT (v_name_in_descr OR v_inv_hit) OR v_amount_diff_pct > 5) THEN
      CONTINUE;
    END IF;

    v_score_total := LEAST(100, v_score_amount + v_score_name + v_score_date + v_bank_bonus + v_score_invoice);

    IF v_score_total > v_best_score THEN
      v_best_score := v_score_total;
      v_best_payable_id := v_pay.id;
      v_best_amount := v_score_amount;
      v_best_name := v_score_name;
      v_best_date := v_score_date;
      v_best_is_closed := v_pay_is_closed;
    END IF;
  END LOOP;

  IF v_best_payable_id IS NULL OR v_best_score < 50 THEN
    RETURN jsonb_build_object('matched', false, 'best_score', v_best_score);
  END IF;

  -- Auto_exact SOLO per le fatture aperte; una fattura già pagata non si chiude mai
  -- in automatico, si propone solo l'aggancio del movimento.
  IF v_best_score >= 80 AND NOT v_best_is_closed THEN
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
    v_bt.company_id, p_bt_id, v_best_payable_id, v_match_type, v_best_score,
    v_best_amount, v_best_name, v_best_date, v_log_status,
    CASE WHEN v_best_is_closed
         THEN 'auto-generated: fattura già pagata — conferma aggancio movimento'
         ELSE 'auto-generated by try_match_bank_transaction' END
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
    'score', v_best_score,
    'match_type', v_match_type,
    'closed_manual', v_best_is_closed,
    'applied', v_match_type = 'auto_exact'
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.try_match_bank_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_match_bank_transaction(uuid) TO authenticated, service_role;
