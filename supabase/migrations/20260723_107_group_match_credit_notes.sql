-- =====================================================================
-- Migrazione 107 — Riconciliazione granitica: include le NOTE DI CREDITO citate
-- =====================================================================
-- RICHIESTA (Patrizio): quando la causale cita una fattura E delle note di credito
-- (es. "SF1757-NC199-214-217"), il sistema deve guardare anche le NC: se
-- fattura − NC == importo del movimento, chiudere INSIEME fattura e note di credito.
--
-- FIX: try_match_group_bank_transaction ora include nel gruppo, oltre alle fatture
-- positive citate (numero >=4 cifre), anche le NOTE DI CREDITO dello stesso
-- fornitore (importo negativo) quando:
--   • la causale contiene il contesto "nc" / "nota" (per evitare falsi positivi), e
--   • il numero della NC (>=3 cifre) è citato in causale come token isolato.
-- La somma del gruppo diventa così (Σ fatture − Σ NC): l'auto-chiusura scatta SOLO
-- se questo netto coincide ESATTAMENTE con il movimento (tol. 0,02 / 1%).
-- In chiusura: le fatture positive si agganciano/pagano come prima; le note di
-- credito si agganciano soltanto (nessuna scrittura di pagamento), registrando che
-- sono state compensate nel pagamento.
--
-- Sui casi che NON tornano (es. MIAN −9.832,06, dove fattura−NC = 9.380,31 ≠
-- movimento) NON scatta nulla: restano alla verifica manuale. Additiva/reversibile.
-- ⚠️ REGOLA #0 — NZ + Made + Zago.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.try_match_group_bank_transaction(p_bt_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bt RECORD; v_descr TEXT; v_mov NUMERIC; v_grp RECORD; v_pay RECORD;
  v_first UUID := NULL; v_linked INT := 0; v_nc INT := 0; v_applied NUMERIC; v_has_nc BOOLEAN;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing'); END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled'); END IF;
  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));
  v_mov := abs(v_bt.amount);
  -- La causale contiene un contesto di nota di credito? (per includere le NC)
  v_has_nc := v_descr ~ '\ync\y' OR v_descr ~ 'nota\s*credito' OR v_descr ~ '\yn\.?c\.?[0-9]';

  SELECT g.supplier_name, g.ids, g.tot, g.n_nc INTO v_grp
  FROM (
    SELECT q.supplier_name, array_agg(q.id) AS ids, sum(q.amt) AS tot,
           count(*) FILTER (WHERE q.is_nc) AS n_nc
    FROM (
      -- Fatture positive citate (numero >=4 cifre)
      SELECT p.id, p.supplier_name, false AS is_nc,
        CASE WHEN p.status = 'pagato' THEN p.gross_amount ELSE COALESCE(p.amount_remaining, p.gross_amount - COALESCE(p.amount_paid, 0), p.gross_amount) END AS amt
      FROM public.payables p
      WHERE p.company_id = v_bt.company_id AND p.bank_transaction_id IS NULL AND p.gross_amount > 0
        AND NOT COALESCE(p.is_placeholder, false)
        AND ( p.status IN ('da_pagare', 'in_scadenza', 'scaduto') OR (p.status = 'pagato' AND COALESCE(p.closed_manually, false)) )
        AND ( (p.supplier_vat IS NOT NULL AND v_descr LIKE '%' || lower(p.supplier_vat) || '%')
          OR EXISTS (SELECT 1 FROM regexp_split_to_table(lower(coalesce(p.supplier_name, '')), '[^a-z0-9]+') w WHERE length(w) >= 4 AND position(w in v_descr) > 0) )
        AND length(ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0')) >= 4
        AND v_descr ~ ('(^|[^0-9])' || ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0') || '([^0-9]|$)')

      UNION ALL

      -- Note di credito dello stesso fornitore citate (numero >=3 cifre), SOLO se la
      -- causale ha contesto "nc"/"nota credito". Importo negativo → riduce la somma.
      SELECT p.id, p.supplier_name, true AS is_nc, p.gross_amount AS amt
      FROM public.payables p
      WHERE v_has_nc
        AND p.company_id = v_bt.company_id AND p.bank_transaction_id IS NULL AND p.gross_amount < 0
        AND NOT COALESCE(p.is_placeholder, false)
        AND ( (p.supplier_vat IS NOT NULL AND v_descr LIKE '%' || lower(p.supplier_vat) || '%')
          OR EXISTS (SELECT 1 FROM regexp_split_to_table(lower(coalesce(p.supplier_name, '')), '[^a-z0-9]+') w WHERE length(w) >= 4 AND position(w in v_descr) > 0) )
        AND length(ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0')) >= 3
        AND v_descr ~ ('(^|[^0-9])' || ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0') || '([^0-9]|$)')
    ) q
    GROUP BY q.supplier_name
    -- Deve esserci almeno una fattura positiva (una NC da sola non è un pagamento)
    HAVING sum(q.amt) FILTER (WHERE NOT q.is_nc) > 0
       AND abs(sum(q.amt) - v_mov) <= GREATEST(0.02, v_mov * 0.01)
    ORDER BY count(*) DESC LIMIT 1
  ) g;

  IF NOT FOUND THEN RETURN jsonb_build_object('matched', false); END IF;

  FOR v_pay IN SELECT * FROM public.payables WHERE id = ANY(v_grp.ids) LOOP
    IF v_first IS NULL AND v_pay.gross_amount > 0 THEN v_first := v_pay.id; END IF;

    IF v_pay.gross_amount < 0 THEN
      -- Nota di credito: solo aggancio (compensata nel pagamento), nessuna scrittura pagamento.
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount, 'auto: nota di credito compensata nel pagamento (citata in causale)');
      v_nc := v_nc + 1;
    ELSIF v_pay.status = 'pagato' AND COALESCE(v_pay.closed_manually, false) AND v_pay.bank_transaction_id IS NULL THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount, 'auto: fattura citata in causale (chiusa a mano — solo aggancio)');
      v_linked := v_linked + 1;
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables SET amount_paid = COALESCE(amount_paid, 0) + v_applied, payment_date = v_bt.transaction_date, bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_applied, 'auto: fattura citata in causale (importo esatto)');
      v_linked := v_linked + 1;
    END IF;
  END LOOP;

  UPDATE public.bank_transactions SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first WHERE id = p_bt_id;

  RETURN jsonb_build_object('matched', true, 'auto', true, 'grouped', (v_linked > 1),
                            'fatture', v_linked, 'note_credito', v_nc, 'supplier', v_grp.supplier_name, 'sum', v_grp.tot, 'movimento', v_mov);
END;
$function$;
