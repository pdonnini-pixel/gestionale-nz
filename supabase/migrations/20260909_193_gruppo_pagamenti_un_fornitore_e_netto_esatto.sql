-- 20260909_193 — Pagamenti raggruppati: un bonifico = un fornitore, somma esatta sul netto.
--
-- Caso reale del 09/09/2026 (NZ). La schermata "Pagamenti raggruppati" proponeva:
--   • bonifico ad AMAZON PAYMENTS EUROPE di 415,85 € accostato alla fattura LNB71972
--     di CNH INDUSTRIAL CAPITAL EUROPE (366,00 €) più due voci Amazon: due fornitori
--     diversi nello stesso bonifico. La combinazione giusta esisteva e faceva 415,85
--     al centesimo (52,72 + 262,24 + 20,89 + 80,00).
--   • bonifico a ZUCCHETTI di 1.351,88 € accostato a fatture che sommano 1.349,52 €.
-- Il frontend le proponeva per una tolleranza troppo larga; questa funzione le avrebbe
-- ACCETTATE, perché tollerava il 2% dell'importo (27 € su Zucchetti) calcolato per di
-- più sul LORDO invece che sul netto.
--
-- Cosa cambia qui:
--   1. il confronto si fa sul NETTO del movimento (bank_movement_net scorpora la
--      commissione dichiarata nei flussi CBI). Le commissioni MPS sui bonifici
--      corporate banking non stanno dentro il movimento: la banca le addebita con una
--      riga separata ("Commissioni su bonifico tramite co…", 0,70 / 0,75 / 1,75 €),
--      quindi l'importo del bonifico deve coincidere col totale delle fatture.
--   2. tolleranza fissa a 0,05 € (era GREATEST(0,05, 2% dell'importo)).
--   3. tutte le fatture del gruppo devono essere dello STESSO fornitore, identificato
--      per P.IVA quando c'è (regola di progetto: mai per nome) e per nome normalizzato
--      solo in mancanza di P.IVA. Altrimenti 'mixed_suppliers'.
--
-- Additiva e non distruttiva: CREATE OR REPLACE di una sola funzione, nessun dato toccato.
-- Rollback in 20260909_193_gruppo_pagamenti_un_fornitore_e_netto_esatto_ROLLBACK.sql

CREATE OR REPLACE FUNCTION public.reconcile_movement_group(p_bt_id uuid, p_payable_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD;
  v_pay RECORD;
  v_n INT;
  v_mov NUMERIC;
  v_sum_target NUMERIC := 0;
  v_applied NUMERIC;
  v_nc NUMERIC;
  v_tol NUMERIC;
  v_first UUID := NULL;
  v_linked INT := 0;
  v_keys INT;
BEGIN
  IF p_payable_ids IS NULL OR array_length(p_payable_ids, 1) IS NULL OR array_length(p_payable_ids, 1) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'need_at_least_two_payables');
  END IF;

  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL THEN
    RAISE EXCEPTION 'Movimento bancario non trovato';
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stale');
  END IF;

  -- NETTO del movimento: nei flussi CBI l'importo è lordo (netto + commissione).
  v_mov := COALESCE(public.bank_movement_net(COALESCE(v_bt.description, '')), abs(v_bt.amount));
  v_tol := 0.05;

  SELECT count(*) INTO v_n FROM public.payables
   WHERE id = ANY(p_payable_ids) AND company_id = v_bt.company_id;
  IF v_n <> array_length(p_payable_ids, 1) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payable_mismatch');
  END IF;

  -- Un bonifico paga UN fornitore solo (R6). Chiave: P.IVA se c'è, altrimenti nome.
  SELECT count(DISTINCT CASE
           WHEN length(regexp_replace(COALESCE(p.supplier_vat, ''), '[^0-9A-Za-z]', '', 'g')) >= 8
             THEN 'VAT:' || upper(regexp_replace(p.supplier_vat, '[^0-9A-Za-z]', '', 'g'))
           ELSE 'NAME:' || upper(regexp_replace(COALESCE(p.supplier_name, ''), '[^0-9A-Za-z]', '', 'g'))
         END)
    INTO v_keys
    FROM public.payables p
   WHERE p.id = ANY(p_payable_ids) AND p.company_id = v_bt.company_id;
  IF v_keys > 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'mixed_suppliers', 'fornitori', v_keys);
  END IF;

  FOR v_pay IN
    SELECT * FROM public.payables WHERE id = ANY(p_payable_ids) AND company_id = v_bt.company_id
  LOOP
    IF v_pay.gross_amount < 0 THEN
      v_sum_target := v_sum_target - abs(v_pay.gross_amount);
    ELSE
      SELECT COALESCE(sum(amount), 0) INTO v_nc
        FROM public.payable_credit_note_links
       WHERE payable_id = v_pay.id AND status = 'pending'
         AND credit_note_payable_id <> ALL(p_payable_ids);
      IF v_pay.status = 'pagato' AND v_pay.bank_transaction_id IS NULL THEN
        v_sum_target := v_sum_target + v_pay.gross_amount - v_nc;
      ELSIF v_pay.status IN ('da_pagare', 'in_scadenza', 'scaduto') THEN
        v_sum_target := v_sum_target + COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount) - v_nc;
      ELSE
        RETURN jsonb_build_object('ok', false, 'reason', 'payable_not_matchable', 'payable_id', v_pay.id, 'status', v_pay.status);
      END IF;
    END IF;
  END LOOP;

  IF abs(v_sum_target - v_mov) > v_tol THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sum_mismatch',
                              'movimento', v_mov, 'somma_netto_nc', v_sum_target, 'scarto', round(v_sum_target - v_mov, 2));
  END IF;

  FOR v_pay IN
    SELECT * FROM public.payables WHERE id = ANY(p_payable_ids) AND company_id = v_bt.company_id
  LOOP
    IF v_pay.gross_amount < 0 THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'manual', 100, 'applied', v_pay.gross_amount,
              'pagamento raggruppato — nota di credito scalata nel gruppo');
      v_linked := v_linked + 1;
      CONTINUE;
    END IF;

    IF v_first IS NULL THEN v_first := v_pay.id; END IF;

    SELECT COALESCE(sum(amount), 0) INTO v_nc
      FROM public.payable_credit_note_links
     WHERE payable_id = v_pay.id AND status = 'pending'
       AND credit_note_payable_id <> ALL(p_payable_ids);

    IF v_pay.status = 'pagato' AND v_pay.bank_transaction_id IS NULL THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_pay.id;
      IF v_nc > 0 THEN
        UPDATE public.payable_credit_note_links SET status = 'applied', applied_at = now()
         WHERE payable_id = v_pay.id AND status = 'pending' AND credit_note_payable_id <> ALL(p_payable_ids);
      END IF;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'manual', 100, 'applied', v_pay.gross_amount - v_nc,
              'pagamento raggruppato (già pagata; netto NC)');
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables
      SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
          payment_date = v_bt.transaction_date,
          bank_transaction_id = p_bt_id,
          updated_at = now()
      WHERE id = v_pay.id;
      IF v_nc > 0 THEN
        UPDATE public.payable_credit_note_links SET status = 'applied', applied_at = now()
         WHERE payable_id = v_pay.id AND status = 'pending' AND credit_note_payable_id <> ALL(p_payable_ids);
      END IF;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_pay.id, 'manual', 100, 'applied', v_applied - v_nc,
              'pagamento raggruppato (movimento unico su più fatture; netto NC)');
    END IF;
    v_linked := v_linked + 1;
  END LOOP;

  IF v_first IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'only_credit_notes');
  END IF;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('ok', true, 'grouped', true, 'linked', v_linked,
                            'bank_transaction_id', p_bt_id, 'somma_netto_nc', v_sum_target, 'movimento', v_mov);
END;
$function$;

-- CREATE OR REPLACE su SECURITY DEFINER rimette EXECUTE a PUBLIC: si ripristinano i grant.
REVOKE ALL ON FUNCTION public.reconcile_movement_group(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_movement_group(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.reconcile_movement_group(uuid, uuid[]) TO authenticated, service_role;
