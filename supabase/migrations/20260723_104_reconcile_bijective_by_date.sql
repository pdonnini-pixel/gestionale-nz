-- =====================================================================
-- Migrazione 104 — Riconciliazione: abbinamento BIETTIVO per data
--                  (univoci auto + costi ricorrenti tipo Trenitalia/Telepass/SPM)
-- =====================================================================
-- PROBLEMA (segnalato da Patrizio): il motore a punteggio, a parità di
-- IMPORTO + NOME, sceglieva sempre la STESSA fattura per tutti i movimenti dello
-- stesso fornitore. Sui costi ricorrenti a importo fisso (NEXI 25,62 ×18,
-- SPM 110 ×5, Trenitalia 502, Telepass/UnipolTech, REMAS, DWS…) la stessa fattura
-- veniva proposta decine di volte, e i casi univoci certi restavano "da confermare".
--
-- SOLUZIONE (biettiva, 1-a-1 per data): per ogni fattura non ancora agganciata,
-- si prende IL movimento — stesso fornitore confermato in causale (P.IVA oppure una
-- parola >=4 char del nome), stesso importo (tol. 0,02 o 1%) — con la DATA PIÙ VICINA
-- alla fattura, e si aggancia. Il movimento viene marcato subito riconciliato, quindi
-- non può essere riusato da un'altra fattura, e viceversa. Così:
--   • fattura UNICA ↔ movimento UNICO  → aggancio automatico (caso "univoco certo");
--   • N fatture mensili ↔ N movimenti mensili (SPM, NEXI…) → accoppiati per data
--     (gennaio↔gennaio, ecc.), mai la stessa fattura due volte;
--   • se i movimenti sono PIÙ delle fatture, gli extra restano non riconciliati
--     (nessuna fattura in gestionale per quel mese) — come richiesto.
-- Fatture aperte: applica il residuo. Fatture chiuse a mano: solo aggancio (la
-- fattura resta pagata, nessuna doppia scrittura). Tutto reversibile (undo).
--
-- Additiva/idempotente. NON distruttiva. ⚠️ REGOLA #0 — NZ + Made + Zago.
-- Dopo l'apply:  SELECT public.rerun_bijective_reconciliation();
-- =====================================================================

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
  -- Itera le fatture candidate ordinate per (azienda, fornitore, importo, data):
  -- così, dentro ogni "bucket" fornitore+importo, le fatture più vecchie scelgono
  -- per prime, in ordine cronologico.
  FOR v_pay IN
    SELECT * FROM public.payables
    WHERE bank_transaction_id IS NULL
      AND gross_amount > 0
      AND supplier_name IS NOT NULL
      AND ( status IN ('da_pagare', 'in_scadenza', 'scaduto')
            OR (status = 'pagato' AND COALESCE(closed_manually, false)) )
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = payables.id AND l.status = 'pending'
      )
    ORDER BY company_id, supplier_name, gross_amount,
             COALESCE(invoice_date, due_date, created_at::date)
  LOOP
    v_inv_date := COALESCE(v_pay.invoice_date, v_pay.due_date, v_pay.created_at::date);

    -- Movimento dello stesso fornitore (nome/P.IVA in causale), stesso importo,
    -- ancora libero, con la data più vicina alla fattura.
    SELECT bt.* INTO v_bt
    FROM public.bank_transactions bt
    WHERE bt.company_id = v_pay.company_id
      AND bt.amount < 0
      AND COALESCE(bt.is_reconciled, false) = false
      AND bt.status IN ('posted', 'booked')
      AND abs(abs(bt.amount) - v_pay.gross_amount) <= GREATEST(0.02, v_pay.gross_amount * 0.01)
      AND (
        (v_pay.supplier_vat IS NOT NULL
          AND lower(coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '') || ' ' || coalesce(bt.merchant_name, ''))
              LIKE '%' || lower(v_pay.supplier_vat) || '%')
        OR EXISTS (
          SELECT 1 FROM regexp_split_to_table(lower(v_pay.supplier_name), '[^a-z0-9]+') w
          WHERE length(w) >= 4
            AND position(w in lower(coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '') || ' ' || coalesce(bt.merchant_name, ''))) > 0
        )
      )
    ORDER BY abs(bt.transaction_date - v_inv_date) ASC, bt.transaction_date DESC
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_pay.status = 'pagato' AND COALESCE(v_pay.closed_manually, false) THEN
      UPDATE public.payables SET bank_transaction_id = v_bt.id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_pay.company_id, v_bt.id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount,
              'auto: abbinamento per data — stesso fornitore/importo (chiusa a mano)');
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
