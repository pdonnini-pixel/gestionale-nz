-- =====================================================================
-- Migrazione 113 — Riconciliazione: conferma fornitore PIU' STRETTA
--                  (stop alle collisioni su parole generiche: PROPCO, GRUPPO…)
-- =====================================================================
-- CAUSA RADICE (caso reale New Zago): i matcher confermavano il fornitore anche con
-- UNA SOLA parola >=4 lettere in comune tra nome fattura e causale. Per gli
-- affittuari/holding con nomi tipo "… PROPCO SRL" o "GRUPPO … SRL" questo genera
-- falsi positivi: es. la fattura di **Palmanova Propco** agganciata a un addebito di
-- **Valdichiana Propco** (parola comune "PROPCO"); **Gruppo FB** agganciata a
-- "Gruppo Servizi Associati" (parola comune "GRUPPO"). Entrambi dal matcher biettivo.
--
-- FIX:
--  1) UNDO mirato dei 4 agganci sbagliati (Palmanova B0202600535, Gruppo FB 4605 ×3):
--     le fatture tornano libere, i movimenti tornano da riconciliare.
--  2) Helper unico `supplier_confirmed_in_text(nome, piva, testo)`: il fornitore è
--     confermato SOLO se la causale contiene la P.IVA, OPPURE una parola >=4 lettere
--     del nome che NON sia generica (PROPCO/GROUP/GRUPPO/HOLDING/SRL/SOCIETA/…).
--  3) I tre matcher (biettivo 104, a punteggio 100, granitico di gruppo 111) usano
--     l'helper al posto del vecchio controllo "parola >=4 qualsiasi".
--
-- Conseguenza: niente più abbinamenti su parole comuni. I fornitori il cui nome è
-- fatto solo di parole generiche/sigle (es. "Gruppo FB", "S.I.A.E.") si abbinano per
-- P.IVA, per numero+importo esatto, o restano da confermare a mano — mai al buio.
--
-- Additiva/idempotente. Reversibile (ROLLBACK a fianco per le funzioni; gli UNDO di
-- dati sono ri-derivabili col motore). NON distruttiva.
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago.
-- Dopo l'apply, ri-eseguire il motore sullo storico:
--     SELECT public.rerun_group_reconciliation();
--     SELECT public.rerun_amount_reconciliation();
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Helper: conferma fornitore (P.IVA oppure parola distintiva non generica).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.supplier_confirmed_in_text(p_name text, p_vat text, p_text text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    (p_vat IS NOT NULL AND p_vat <> '' AND position(lower(p_vat) in lower(coalesce(p_text, ''))) > 0)
    OR EXISTS (
      SELECT 1 FROM regexp_split_to_table(lower(coalesce(p_name, '')), '[^a-z0-9]+') w
      WHERE length(w) >= 4
        AND w NOT IN (
          'srl','srls','spa','snc','sas','sapa','scarl','scrl','propco','group','gruppo',
          'holding','italia','italy','italiana','societa','coop','cooperativa',
          'unipersonale','socio','unico','associati','associato','servizi','service','services'
        )
        AND position(w in lower(coalesce(p_text, ''))) > 0
    );
$function$;

REVOKE EXECUTE ON FUNCTION public.supplier_confirmed_in_text(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_confirmed_in_text(text, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1) UNDO mirato dei 4 agganci sbagliati.
-- ---------------------------------------------------------------------
-- 1a) libera i movimenti agganciati a quelle fatture.
UPDATE public.bank_transactions bt
SET is_reconciled = false, reconciled_at = NULL, reconciled_invoice_id = NULL
WHERE bt.id IN (
  SELECT p.bank_transaction_id FROM public.payables p
  WHERE p.bank_transaction_id IS NOT NULL
    AND ( (p.supplier_name ILIKE '%palmanova%' AND p.invoice_number = 'B0202600535')
       OR (p.supplier_name ILIKE 'gruppo fb%' AND p.invoice_number = '4605') )
);

-- 1b) fatture APERTE erroneamente chiuse (Gruppo FB) -> tornano non pagate.
UPDATE public.payables p
SET amount_paid = 0, payment_date = NULL, bank_transaction_id = NULL,
    status = 'da_pagare'::payable_status, updated_at = now()
WHERE p.supplier_name ILIKE 'gruppo fb%' AND p.invoice_number = '4605'
  AND NOT COALESCE(p.closed_manually, false);

-- 1c) fatture CHIUSE A MANO (Palmanova) -> solo scollega (restano pagate).
UPDATE public.payables p
SET bank_transaction_id = NULL, updated_at = now()
WHERE p.supplier_name ILIKE '%palmanova%' AND p.invoice_number = 'B0202600535'
  AND COALESCE(p.closed_manually, false);

-- 1d) rimuove le righe di log di quei 4 abbinamenti.
DELETE FROM public.reconciliation_log rl
WHERE rl.payable_id IN (
  SELECT p.id FROM public.payables p
  WHERE (p.supplier_name ILIKE '%palmanova%' AND p.invoice_number = 'B0202600535')
     OR (p.supplier_name ILIKE 'gruppo fb%' AND p.invoice_number = '4605')
);

-- ---------------------------------------------------------------------
-- 2) Matcher BIETTIVO (104): conferma fornitore via helper.
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
      AND ( status IN ('da_pagare', 'in_scadenza', 'scaduto')
            OR (status = 'pagato' AND COALESCE(closed_manually, false)) )
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

-- ---------------------------------------------------------------------
-- 3) Matcher GRANITICO DI GRUPPO (111): conferma fornitore via helper.
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
        AND ( p.status IN ('da_pagare', 'in_scadenza', 'scaduto')
              OR (p.status = 'pagato' AND COALESCE(p.closed_manually, false)) )
        AND public.supplier_confirmed_in_text(p.supplier_name, p.supplier_vat, v_descr)
        AND (
          ( length(ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0')) >= 4
            AND v_descr ~ ('(^|[^0-9])' || ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0') || '([^0-9]|$)') )
          OR
          ( length(ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0')) BETWEEN 2 AND 3
            AND v_descr ~ '(saldo|fattura|fatt|nota|parcella)'
            AND v_descr ~ ('(^|[^0-9])' || ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0') || '([^0-9]|$)') )
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

    IF v_pay.status = 'pagato' AND COALESCE(v_pay.closed_manually, false) AND v_pay.bank_transaction_id IS NULL THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount,
              'auto: fattura citata in causale (chiusa a mano — solo aggancio)');
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
-- 4) Matcher A PUNTEGGIO (100): la corroborazione "fornitore in causale" usa l'helper.
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
           (status = 'pagato' AND COALESCE(closed_manually, false) = true) AS is_closed_manual
    FROM public.payables
    WHERE company_id = v_bt.company_id
      AND bank_transaction_id IS NULL
      AND gross_amount > 0
      AND (
        status IN ('da_pagare', 'in_scadenza', 'scaduto')
        OR (status = 'pagato' AND COALESCE(closed_manually, false) = true)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = payables.id AND l.status = 'pending'
      )
  LOOP
    v_pay_is_closed := COALESCE(v_pay.is_closed_manual, false);

    v_amount_diff_pct := abs(abs(v_bt.amount) - v_pay.gross_amount) / v_pay.gross_amount * 100;
    v_score_amount := GREATEST(0, 50 - v_amount_diff_pct * 5);

    -- Nome/P.IVA: punteggio + flag "fornitore presente in causale" (per la tripla conferma).
    -- Il flag di corroborazione ora passa dall'helper: P.IVA o parola distintiva NON generica.
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

    -- Gate per le fatture CHIUSE A MANO: mai solo-importo. Serve fornitore confermato
    -- (helper) OPPURE numero fattura, e importo coerente (<= 5%).
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

  -- Auto_exact SOLO per le fatture aperte con corroborazione forte (nome via helper
  -- OPPURE numero fattura). Senza corroborazione: si propone, non si chiude.
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
         THEN 'auto-generated: fattura chiusa a mano — conferma aggancio movimento'
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
