-- =====================================================================
-- Migrazione 120 — SDD cumulativi: aggancio granitico per NUMERI di fattura in causale
-- =====================================================================
-- CASO REALE (New Zago, HERA COMM): gli addebiti SDD sono pagamenti CUMULATIVI —
-- un addebito salda più fatture, e i numeri delle fatture sono elencati nella causale
-- (es. "…200022190530-412607309402-412607309403-…-412607309409"). Le 51 fatture HERA
-- nel gestionale sono collegate al fornitore via `supplier_id`, ma il campo
-- `supplier_name` della fattura NON contiene "HERA" (porta il testo grezzo dell'SDD).
-- Il matcher granitico (try_match_group_bank_transaction) pretende il NOME confermato
-- in causale via supplier_confirmed_in_text(supplier_name, …) → esclude HERA e non la
-- riconcilia, anche se i numeri fattura sono lì e sommano al centesimo.
--
-- FIX: nuovo matcher `try_match_group_numbers_bank_transaction` GUIDATO DAI NUMERI:
--   • candidate = fatture (aperte o "pagato" senza aggancio, R2) il cui numero
--     (>= 6 cifre, token isolato) compare in causale. Un numero a 6+ cifre identifica
--     il fornitore da solo: non serve il nome in causale.
--   • raggruppa per `supplier_id` (fallback supplier_name); aggancia SOLO se ESISTE
--     UN SOLO fornitore le cui fatture citate sommano al movimento (R6: 1 movimento =
--     1 fornitore). Se due fornitori quadrano entrambi → niente (nessun indovinello).
--   • tutto-o-niente: aggancia l'intero gruppo o nulla.
--   • le fatture "pagato" si SOLO agganciano (R2/R11: nessuna doppia scrittura).
-- Aggiunto a rerun_group_reconciliation come secondo tentativo (dopo il matcher a nome).
--
-- SAFETY UTENZE (R13): close_utility_movements NON chiude più un movimento che elenca
-- in causale numeri di fattura reali (>= 6 cifre) di una fattura non ancora agganciata:
-- se c'è una fattura da agganciare, ha la precedenza sulla chiusura come "utenza".
-- (Impedisce il ripetersi del caso HERA: fatture cumulative chiuse come utenza.)
--
-- Additiva/idempotente. NON distruttiva (solo aggancio; reversibile con
-- undo_reconcile_movement). ⚠️ REGOLA #0 — NZ + Made + Zago.
-- Dopo l'apply:  SELECT public.rerun_group_reconciliation();  (o run_daily_reconciliation)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Matcher granitico GUIDATO DAI NUMERI (senza bisogno del nome in causale).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_match_group_numbers_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bt RECORD;
  v_descr TEXT;
  v_mov NUMERIC;
  v_cnt INT;
  v_ids uuid[];
  v_tot NUMERIC;
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

  -- Fatture il cui numero (>= 6 cifre, token isolato) è citato in causale, raggruppate
  -- per fornitore. v_cnt = quanti fornitori quadrano col movimento: deve essere ESATTAMENTE 1.
  WITH hits AS (
    SELECT p.id,
           COALESCE(p.supplier_id::text, p.supplier_name) AS sid,
           CASE WHEN p.status = 'pagato' THEN p.gross_amount
                ELSE COALESCE(p.amount_remaining, p.gross_amount - COALESCE(p.amount_paid, 0), p.gross_amount) END AS amt
    FROM public.payables p
    WHERE p.company_id = v_bt.company_id
      AND p.bank_transaction_id IS NULL
      AND p.gross_amount > 0
      AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto', 'pagato')
      AND length(regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g')) >= 6
      AND v_descr ~ ('(^|[^0-9])' || regexp_replace(coalesce(p.invoice_number, ''), '[^0-9]', '', 'g') || '([^0-9]|$)')
  ),
  grp AS (
    SELECT sid, array_agg(id) AS ids, sum(amt) AS tot
    FROM hits
    GROUP BY sid
    HAVING abs(sum(amt) - v_mov) <= GREATEST(0.02, v_mov * 0.01)
  )
  SELECT (SELECT count(*) FROM grp), g.ids, g.tot
  INTO v_cnt, v_ids, v_tot
  FROM grp g
  LIMIT 1;

  IF v_cnt IS NULL OR v_cnt <> 1 THEN
    RETURN jsonb_build_object('matched', false, 'reason', COALESCE('ambiguous_or_none', ''));
  END IF;

  FOR v_pay IN SELECT * FROM public.payables WHERE id = ANY(v_ids) LOOP
    IF v_first IS NULL THEN v_first := v_pay.id; END IF;

    IF v_pay.status = 'pagato' AND v_pay.bank_transaction_id IS NULL THEN  -- R2: già pagata → solo aggancio
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount,
              'auto: numero fattura citato in causale — SDD cumulativo (già pagata, solo aggancio)');
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
              'auto: numero fattura citato in causale — SDD cumulativo (importo esatto)');
    END IF;
    v_linked := v_linked + 1;
  END LOOP;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('matched', true, 'auto', true, 'grouped', (v_linked > 1),
                            'linked', v_linked, 'sum', v_tot, 'movimento', v_mov, 'by', 'invoice_numbers');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.try_match_group_numbers_bank_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_match_group_numbers_bank_transaction(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2) rerun_group_reconciliation: prova il matcher a NOME e, se non aggancia,
--    il matcher guidato dai NUMERI.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rerun_group_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r RECORD;
  v_proc INT := 0;
  v_match INT := 0;
  v_linked INT := 0;
  v_res jsonb;
BEGIN
  FOR r IN
    SELECT id FROM public.bank_transactions
    WHERE amount < 0 AND status IN ('posted', 'booked') AND COALESCE(is_reconciled, false) = false
  LOOP
    v_proc := v_proc + 1;
    v_res := public.try_match_group_bank_transaction(r.id);
    IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
      v_res := public.try_match_group_numbers_bank_transaction(r.id);
    END IF;
    IF COALESCE((v_res->>'matched')::boolean, false) THEN
      v_match := v_match + 1;
      v_linked := v_linked + COALESCE((v_res->>'linked')::int, 0);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('processed', v_proc, 'matched', v_match, 'fatture_agganciate', v_linked);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rerun_group_reconciliation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rerun_group_reconciliation() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3) close_utility_movements: la fattura ha SEMPRE la precedenza. Non chiudere come
--    "utenza" un movimento che elenca in causale numeri di fattura reali (>= 6 cifre)
--    di una fattura non ancora agganciata.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_utility_movements()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n INT;
BEGIN
  WITH upd AS (
    UPDATE public.bank_transactions bt
    SET is_reconciled = true,
        reconciled_at = now(),
        category = COALESCE(bt.category, 'utenze'),
        note = COALESCE(bt.note || ' | ', '') || 'chiuso automaticamente (utenza — addebito permanente)'
    WHERE bt.amount < 0
      AND COALESCE(bt.is_reconciled, false) = false
      AND bt.status IN ('posted', 'booked')
      -- niente fattura agganciata né proposta pendente: la fattura ha sempre la precedenza
      AND NOT EXISTS (
        SELECT 1 FROM public.reconciliation_log rl
        WHERE rl.bank_transaction_id = bt.id AND rl.status IN ('applied', 'to_confirm'))
      -- niente numeri di fattura reali (>= 6 cifre) citati in causale: se c'è una fattura
      -- da agganciare, la aggancia il matcher, NON si chiude come utenza generica
      AND NOT EXISTS (
        SELECT 1 FROM public.payables p2
        WHERE p2.company_id = bt.company_id
          AND p2.bank_transaction_id IS NULL
          AND p2.gross_amount > 0
          AND length(regexp_replace(coalesce(p2.invoice_number, ''), '[^0-9]', '', 'g')) >= 6
          AND lower(coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '')) ~
              ('(^|[^0-9])' || regexp_replace(coalesce(p2.invoice_number, ''), '[^0-9]', '', 'g') || '([^0-9]|$)'))
      -- beneficiario = fornitore-utenza, confermato a CONFINE DI PAROLA (per P.IVA o token isolato)
      AND EXISTS (
        SELECT 1 FROM public.suppliers s
        WHERE s.company_id = bt.company_id
          AND COALESCE(s.is_utility, false) = true
          AND public.supplier_confirmed_in_text_strict(
                s.name, COALESCE(s.vat_number, s.partita_iva),
                coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '')))
    RETURNING bt.id
  )
  SELECT count(*) INTO v_n FROM upd;
  RETURN jsonb_build_object('chiusi_utenze', v_n);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.close_utility_movements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_utility_movements() TO authenticated, service_role;
