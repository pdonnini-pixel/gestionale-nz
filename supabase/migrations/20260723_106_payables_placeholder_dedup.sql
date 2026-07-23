-- =====================================================================
-- Migrazione 106 — Doppioni fatture: marcatore is_placeholder + bonifica
-- =====================================================================
-- CONTESTO (analizzato con Patrizio): durante go-live e sync SDI/Cassetto di
-- giugno-luglio molte fatture sono state importate 2-3 volte. Su NZ: 199 righe
-- doppione, di cui ~130 APERTE che gonfiano lo scadenzario di ~257.723 € fantasma.
-- Backup già salvato in public.payables_dup_backup_20260723 (342 righe).
--
-- SOLUZIONE (non distruttiva, reversibile): colonna is_placeholder. Le copie in
-- eccesso vengono marcate is_placeholder=true (NON cancellate) e diventano
-- invisibili a scadenzario (vista v_payables_operative) e al motore di
-- riconciliazione. Per tornare indietro basta rimettere is_placeholder=false.
--
-- REGOLA di marcatura (sicura): per ogni cluster fornitore + numero fattura +
-- importo arrotondato all'euro, si TIENE una riga (priorità: quella col movimento
-- bancario > pagata > chiusa a mano > più vecchia) e si marcano le altre. Non si
-- marca MAI una riga con un movimento bancario reale (guardia bank_transaction_id).
-- I documenti a importo davvero diverso (stesso numero ma importi diversi, es.
-- rettifiche) restano cluster separati → non toccati.
--
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago.
-- =====================================================================

-- 1) Colonna marcatore (additiva, default false → nessun impatto sulle righe esistenti)
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS is_placeholder boolean NOT NULL DEFAULT false;

-- 2) Backfill: marca le copie in eccesso (tiene la migliore per cluster)
UPDATE public.payables SET is_placeholder = true, updated_at = now()
WHERE id IN (
  SELECT id FROM (
    SELECT id, bank_transaction_id,
      row_number() OVER (
        PARTITION BY company_id, supplier_name, invoice_number, round(gross_amount)
        ORDER BY (bank_transaction_id IS NOT NULL) DESC,
                 (status = 'pagato') DESC,
                 closed_manually DESC,
                 created_at ASC
      ) rn
    FROM public.payables
    WHERE invoice_number IS NOT NULL AND invoice_number <> ''
  ) q
  WHERE q.rn > 1 AND q.bank_transaction_id IS NULL
);

-- 3) Vista scadenzario: nasconde i placeholder (unica sorgente della pagina Scadenzario)
CREATE OR REPLACE VIEW public.v_payables_operative AS
 SELECT p.id, p.company_id, p.outlet_id, p.supplier_id,
    o.name AS outlet_name, o.code AS outlet_code,
    COALESCE(s.name, p.supplier_name) AS supplier_name,
    COALESCE(s.ragione_sociale, s.name, p.supplier_name) AS supplier_ragione_sociale,
    COALESCE(s.category, 'altro'::text) AS supplier_category,
    COALESCE(p.iban, s.iban) AS supplier_iban,
    COALESCE(s.partita_iva, s.vat_number, p.supplier_vat) AS supplier_vat,
    p.invoice_number, p.invoice_date, p.original_due_date, p.due_date, p.postponed_to, p.postpone_count,
    p.gross_amount, p.amount_paid, p.amount_remaining, p.payment_method, p.status, p.priority,
    p.suspend_reason, p.suspend_date,
    cc.name AS cost_category_name, cc.macro_group,
    CASE WHEN p.status = 'sospeso'::payable_status THEN NULL::integer
         WHEN p.status = 'pagato'::payable_status THEN NULL::integer
         ELSE p.due_date - CURRENT_DATE END AS days_to_due,
    CASE WHEN p.status = 'pagato'::payable_status THEN 'paid'::text
         WHEN p.status = 'annullato'::payable_status THEN 'cancelled'::text
         WHEN p.status = 'sospeso'::payable_status THEN 'suspended'::text
         WHEN p.due_date < CURRENT_DATE THEN 'overdue'::text
         WHEN p.due_date <= (CURRENT_DATE + 7) THEN 'urgent'::text
         WHEN p.due_date <= (CURRENT_DATE + 30) THEN 'upcoming'::text
         ELSE 'ok'::text END AS urgency,
    last_action.action_type AS last_action_type,
    last_action.note AS last_action_note,
    last_action.performed_at AS last_action_date,
    last_action.performer_name AS last_action_by,
    p.notes
   FROM payables p
     LEFT JOIN outlets o ON o.id = p.outlet_id
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN cost_categories cc ON cc.id = p.cost_category_id
     LEFT JOIN LATERAL ( SELECT pa.action_type, pa.note, pa.performed_at,
            (up.first_name || ' '::text) || up.last_name AS performer_name
           FROM payable_actions pa
             LEFT JOIN user_profiles up ON up.id = pa.performed_by
          WHERE pa.payable_id = p.id
          ORDER BY pa.performed_at DESC
         LIMIT 1) last_action ON true
  WHERE NOT COALESCE(p.is_placeholder, false)
  ORDER BY (CASE p.status
            WHEN 'scaduto'::payable_status THEN 0
            WHEN 'in_scadenza'::payable_status THEN 1
            WHEN 'parziale'::payable_status THEN 2
            WHEN 'da_pagare'::payable_status THEN 3
            WHEN 'sospeso'::payable_status THEN 4
            WHEN 'rimandato'::payable_status THEN 5
            WHEN 'pagato'::payable_status THEN 6
            WHEN 'annullato'::payable_status THEN 7
            ELSE NULL::integer END), p.due_date;

-- 4) Guardia is_placeholder nei candidati del motore di riconciliazione.
--    (Un doppione marcato non deve mai essere abbinato a un movimento.)

CREATE OR REPLACE FUNCTION public.try_match_bank_transaction(p_bt_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bt RECORD; v_pay RECORD; v_best_payable_id UUID; v_best_score NUMERIC := 0;
  v_best_amount NUMERIC := 0; v_best_name NUMERIC := 0; v_best_date NUMERIC := 0;
  v_best_is_closed BOOLEAN := false; v_pay_is_closed BOOLEAN;
  v_score_amount NUMERIC; v_score_name NUMERIC; v_score_date NUMERIC; v_score_invoice NUMERIC;
  v_score_total NUMERIC; v_bank_bonus NUMERIC; v_amount_diff_pct NUMERIC; v_days_diff INTEGER;
  v_match_type TEXT; v_log_status TEXT; v_descr TEXT; v_name_in_descr BOOLEAN; v_inv_hit BOOLEAN;
  v_inv_norm TEXT; v_inv_re TEXT;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN RETURN jsonb_build_object('skipped', true, 'reason', 'amount_not_negative_or_tx_not_found'); END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN RETURN jsonb_build_object('skipped', true, 'reason', 'already_reconciled'); END IF;
  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));
  FOR v_pay IN
    SELECT *, (status = 'pagato' AND COALESCE(closed_manually, false) = true) AS is_closed_manual
    FROM public.payables
    WHERE company_id = v_bt.company_id AND bank_transaction_id IS NULL AND gross_amount > 0
      AND NOT COALESCE(is_placeholder, false)
      AND ( status IN ('da_pagare', 'in_scadenza', 'scaduto') OR (status = 'pagato' AND COALESCE(closed_manually, false)) )
      AND NOT EXISTS (SELECT 1 FROM public.payable_credit_note_links l WHERE l.payable_id = payables.id AND l.status = 'pending')
  LOOP
    v_pay_is_closed := COALESCE(v_pay.is_closed_manual, false);
    v_amount_diff_pct := abs(abs(v_bt.amount) - v_pay.gross_amount) / v_pay.gross_amount * 100;
    v_score_amount := GREATEST(0, 50 - v_amount_diff_pct * 5);
    v_score_name := 0; v_name_in_descr := false;
    IF v_pay.supplier_vat IS NOT NULL AND v_descr LIKE '%' || lower(v_pay.supplier_vat) || '%' THEN
      v_score_name := 30; v_name_in_descr := true;
    ELSIF v_pay.supplier_name IS NOT NULL AND v_descr LIKE '%' || lower(v_pay.supplier_name) || '%' THEN
      v_score_name := 25; v_name_in_descr := true;
    ELSIF v_pay.supplier_name IS NOT NULL THEN
      v_score_name := similarity(v_descr, lower(v_pay.supplier_name)) * 30;
      IF EXISTS (SELECT 1 FROM regexp_split_to_table(lower(v_pay.supplier_name), '[^a-z0-9]+') w WHERE length(w) >= 4 AND position(w in v_descr) > 0) THEN v_name_in_descr := true; END IF;
    END IF;
    IF v_pay.due_date IS NULL THEN v_score_date := 0;
    ELSE v_days_diff := abs(v_bt.transaction_date - v_pay.due_date); v_score_date := GREATEST(0, 20 - v_days_diff); END IF;
    v_bank_bonus := 0;
    IF v_pay.payment_bank_account_id IS NOT NULL AND v_pay.payment_bank_account_id = v_bt.bank_account_id THEN v_bank_bonus := 10; END IF;
    v_score_invoice := 0; v_inv_hit := false;
    v_inv_norm := regexp_replace(lower(coalesce(v_pay.invoice_number, '')), '[^a-z0-9]', '', 'g');
    IF length(v_inv_norm) >= 2 THEN
      v_inv_re := '(^|[^a-z0-9])' || regexp_replace(lower(trim(v_pay.invoice_number)), '[^a-z0-9]+', '[^a-z0-9]{0,3}', 'g') || '([^a-z0-9]|$)';
      IF v_descr ~ v_inv_re THEN
        IF length(v_inv_norm) >= 5 THEN v_inv_hit := true; v_score_invoice := CASE WHEN v_amount_diff_pct <= 2 THEN 45 ELSE 15 END;
        ELSIF v_amount_diff_pct <= 2 AND v_name_in_descr THEN v_inv_hit := true; v_score_invoice := 45; END IF;
      END IF;
    END IF;
    IF v_pay_is_closed AND (NOT (v_name_in_descr OR v_inv_hit) OR v_amount_diff_pct > 5) THEN CONTINUE; END IF;
    v_score_total := LEAST(100, v_score_amount + v_score_name + v_score_date + v_bank_bonus + v_score_invoice);
    IF v_score_total > v_best_score THEN
      v_best_score := v_score_total; v_best_payable_id := v_pay.id; v_best_amount := v_score_amount;
      v_best_name := v_score_name; v_best_date := v_score_date; v_best_is_closed := v_pay_is_closed;
    END IF;
  END LOOP;
  IF v_best_payable_id IS NULL OR v_best_score < 50 THEN RETURN jsonb_build_object('matched', false, 'best_score', v_best_score); END IF;
  IF v_best_score >= 80 AND NOT v_best_is_closed THEN v_match_type := 'auto_exact'; v_log_status := 'applied';
  ELSE v_match_type := 'auto_fuzzy'; v_log_status := 'to_confirm'; END IF;
  INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, score_amount, score_name, score_date, status, notes)
  VALUES (v_bt.company_id, p_bt_id, v_best_payable_id, v_match_type, v_best_score, v_best_amount, v_best_name, v_best_date, v_log_status,
    CASE WHEN v_best_is_closed THEN 'auto-generated: fattura chiusa a mano — conferma aggancio movimento' ELSE 'auto-generated by try_match_bank_transaction' END);
  IF v_match_type = 'auto_exact' THEN
    UPDATE public.payables SET bank_transaction_id = p_bt_id, status = 'pagato'::payable_status, amount_paid = gross_amount, amount_remaining = 0, payment_date = v_bt.transaction_date, updated_at = now() WHERE id = v_best_payable_id;
    UPDATE public.bank_transactions SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_best_payable_id WHERE id = p_bt_id;
  END IF;
  RETURN jsonb_build_object('matched', true, 'payable_id', v_best_payable_id, 'score', v_best_score, 'match_type', v_match_type, 'closed_manual', v_best_is_closed, 'applied', v_match_type = 'auto_exact');
END;
$function$;

CREATE OR REPLACE FUNCTION public.try_match_group_bank_transaction(p_bt_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bt RECORD; v_descr TEXT; v_mov NUMERIC; v_grp RECORD; v_pay RECORD; v_first UUID := NULL; v_linked INT := 0; v_applied NUMERIC;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing'); END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled'); END IF;
  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));
  v_mov := abs(v_bt.amount);
  SELECT g.supplier_name, g.ids, g.tot INTO v_grp
  FROM (
    SELECT q.supplier_name, array_agg(q.id) AS ids, sum(q.amt) AS tot
    FROM (
      SELECT p.id, p.supplier_name,
        CASE WHEN p.status = 'pagato' THEN p.gross_amount ELSE COALESCE(p.amount_remaining, p.gross_amount - COALESCE(p.amount_paid, 0), p.gross_amount) END AS amt
      FROM public.payables p
      WHERE p.company_id = v_bt.company_id AND p.bank_transaction_id IS NULL AND p.gross_amount > 0
        AND NOT COALESCE(p.is_placeholder, false)
        AND ( p.status IN ('da_pagare', 'in_scadenza', 'scaduto') OR (p.status = 'pagato' AND COALESCE(p.closed_manually, false)) )
        AND ( (p.supplier_vat IS NOT NULL AND v_descr LIKE '%' || lower(p.supplier_vat) || '%')
          OR EXISTS (SELECT 1 FROM regexp_split_to_table(lower(coalesce(p.supplier_name, '')), '[^a-z0-9]+') w WHERE length(w) >= 4 AND position(w in v_descr) > 0) )
        AND length(ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0')) >= 4
        AND v_descr ~ ('(^|[^0-9])' || ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0') || '([^0-9]|$)')
    ) q
    GROUP BY q.supplier_name
    HAVING abs(sum(q.amt) - v_mov) <= GREATEST(0.02, v_mov * 0.01)
    ORDER BY count(*) DESC LIMIT 1
  ) g;
  IF NOT FOUND THEN RETURN jsonb_build_object('matched', false); END IF;
  FOR v_pay IN SELECT * FROM public.payables WHERE id = ANY(v_grp.ids) LOOP
    IF v_first IS NULL THEN v_first := v_pay.id; END IF;
    IF v_pay.status = 'pagato' AND COALESCE(v_pay.closed_manually, false) AND v_pay.bank_transaction_id IS NULL THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount, 'auto: fattura citata in causale (chiusa a mano — solo aggancio)');
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables SET amount_paid = COALESCE(amount_paid, 0) + v_applied, payment_date = v_bt.transaction_date, bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_applied, 'auto: fattura citata in causale (importo esatto)');
    END IF;
    v_linked := v_linked + 1;
  END LOOP;
  UPDATE public.bank_transactions SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first WHERE id = p_bt_id;
  RETURN jsonb_build_object('matched', true, 'auto', true, 'grouped', (v_linked > 1), 'linked', v_linked, 'supplier', v_grp.supplier_name, 'sum', v_grp.tot, 'movimento', v_mov);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rerun_bijective_reconciliation()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_pay RECORD; v_bt RECORD; v_applied NUMERIC; v_pairs INT := 0; v_inv_date DATE;
BEGIN
  FOR v_pay IN
    SELECT * FROM public.payables
    WHERE bank_transaction_id IS NULL AND gross_amount > 0 AND supplier_name IS NOT NULL
      AND NOT COALESCE(is_placeholder, false)
      AND ( status IN ('da_pagare', 'in_scadenza', 'scaduto') OR (status = 'pagato' AND COALESCE(closed_manually, false)) )
      AND NOT EXISTS (SELECT 1 FROM public.payable_credit_note_links l WHERE l.payable_id = payables.id AND l.status = 'pending')
    ORDER BY company_id, supplier_name, gross_amount, COALESCE(invoice_date, due_date, created_at::date)
  LOOP
    v_inv_date := COALESCE(v_pay.invoice_date, v_pay.due_date, v_pay.created_at::date);
    SELECT bt.* INTO v_bt FROM public.bank_transactions bt
    WHERE bt.company_id = v_pay.company_id AND bt.amount < 0 AND COALESCE(bt.is_reconciled, false) = false AND bt.status IN ('posted', 'booked')
      AND abs(abs(bt.amount) - v_pay.gross_amount) <= GREATEST(0.02, v_pay.gross_amount * 0.01)
      AND ( (v_pay.supplier_vat IS NOT NULL AND lower(coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '') || ' ' || coalesce(bt.merchant_name, '')) LIKE '%' || lower(v_pay.supplier_vat) || '%')
        OR EXISTS (SELECT 1 FROM regexp_split_to_table(lower(v_pay.supplier_name), '[^a-z0-9]+') w WHERE length(w) >= 4 AND position(w in lower(coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '') || ' ' || coalesce(bt.merchant_name, ''))) > 0) )
    ORDER BY abs(bt.transaction_date - v_inv_date) ASC, bt.transaction_date DESC LIMIT 1;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_pay.status = 'pagato' AND COALESCE(v_pay.closed_manually, false) THEN
      UPDATE public.payables SET bank_transaction_id = v_bt.id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_pay.company_id, v_bt.id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount, 'auto: abbinamento per data — stesso fornitore/importo (chiusa a mano)');
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables SET amount_paid = COALESCE(amount_paid, 0) + v_applied, payment_date = v_bt.transaction_date, bank_transaction_id = v_bt.id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_pay.company_id, v_bt.id, v_pay.id, 'auto_exact', 100, 'applied', v_applied, 'auto: abbinamento per data — stesso fornitore/importo');
    END IF;
    UPDATE public.bank_transactions SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_pay.id WHERE id = v_bt.id;
    v_pairs := v_pairs + 1;
  END LOOP;
  RETURN jsonb_build_object('coppie_abbinate', v_pairs);
END;
$function$;
