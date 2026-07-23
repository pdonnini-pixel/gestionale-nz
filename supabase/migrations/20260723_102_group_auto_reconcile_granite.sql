-- =====================================================================
-- Migrazione 102 — Riconciliazione: auto-abbinamento dei casi GRANITICI
--                  (fornitore + numeri fattura citati in causale + importo esatto)
-- =====================================================================
-- REGOLA (Patrizio): non ha senso far confermare a mano ciò che è certo. Se la
-- causale del movimento cita ESPLICITAMENTE il fornitore e i numeri di fattura,
-- e la somma di quelle fatture coincide ESATTAMENTE con l'importo del movimento,
-- è granitico → si riconcilia da solo. Si propone (to_confirm) solo l'incerto.
--
-- Es. reale: "…a favore di: SFORAZZINI SRL SALDO FATTURA 5421-5422", −466,95 =
-- fattura 5421 (155,65) + fattura 5422 (311,30). Certo → auto.
--
-- Questa funzione, per un movimento in uscita non ancora riconciliato, cerca UN
-- gruppo granitico di fatture dello stesso fornitore:
--   • fornitore confermato in causale (P.IVA, oppure una parola >=4 char del nome);
--   • ogni fattura col proprio numero citato in causale come TOKEN ISOLATO
--     (nucleo numerico >= 4 cifre, così si escludono i numeri corti/ambigui);
--   • somma degli importi da agganciare == importo movimento (tol. 0,02 o 1%).
-- Se lo trova, riconcilia in automatico (fatture aperte: applica il residuo;
-- fatture chiuse a mano: solo aggancio, nessuna doppia scrittura). Copre anche il
-- caso di UNA sola fattura citata a importo esatto (chiusa a mano → aggancio auto).
-- Se NON è granitico non fa nulla: restano i suggerimenti "da confermare".
--
-- Il trigger di inserimento prova PRIMA questo abbinamento granitico e, solo se
-- non scatta, il matching a punteggio (try_match_bank_transaction).
--
-- Additiva/idempotente. NON distruttiva (link additivo, reversibile con
-- undo_reconcile_movement). ⚠️ REGOLA #0 — applicare su NZ + Made + Zago.
-- Dopo l'apply, per l'auto-abbinamento dello STORICO:  SELECT public.rerun_group_reconciliation();
-- =====================================================================

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

  -- Cerca il gruppo granitico (stesso fornitore, numeri citati, somma esatta).
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
        AND (
          (p.supplier_vat IS NOT NULL AND v_descr LIKE '%' || lower(p.supplier_vat) || '%')
          OR EXISTS (SELECT 1 FROM regexp_split_to_table(lower(coalesce(p.supplier_name, '')), '[^a-z0-9]+') w
                     WHERE length(w) >= 4 AND position(w in v_descr) > 0)
        )
        AND length(ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0')) >= 4
        AND v_descr ~ ('(^|[^0-9])' || ltrim(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g'), '0') || '([^0-9]|$)')
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

-- Trigger: prova PRIMA l'abbinamento granitico; solo se non scatta, il matching a punteggio.
CREATE OR REPLACE FUNCTION public.trg_auto_reconcile_bank_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF NEW.status = 'posted' AND NEW.amount < 0 THEN
    v_res := public.try_match_group_bank_transaction(NEW.id);
    IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
      PERFORM public.try_match_bank_transaction(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Batch: auto-abbina i gruppi granitici sullo storico (solo auto, nessuna proposta).
CREATE OR REPLACE FUNCTION public.rerun_group_reconciliation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_proc INT := 0;
  v_match INT := 0;
  v_linked INT := 0;
  v_res jsonb;
BEGIN
  FOR r IN
    SELECT id FROM public.bank_transactions
    WHERE amount < 0 AND status = 'posted' AND COALESCE(is_reconciled, false) = false
  LOOP
    v_proc := v_proc + 1;
    v_res := public.try_match_group_bank_transaction(r.id);
    IF COALESCE((v_res->>'matched')::boolean, false) THEN
      v_match := v_match + 1;
      v_linked := v_linked + COALESCE((v_res->>'linked')::int, 0);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('processed', v_proc, 'matched', v_match, 'fatture_agganciate', v_linked);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rerun_group_reconciliation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rerun_group_reconciliation() TO authenticated, service_role;
