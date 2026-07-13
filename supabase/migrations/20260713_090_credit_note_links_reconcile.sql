-- =====================================================================
-- Migrazione 090 — Legame Nota di Credito ↔ Fattura + riconciliazione che compensa le NC
-- (Passo 2 del ciclo distinta / "in sospeso")
-- =====================================================================
--
-- CONTESTO
-- Alla Conferma distinta la compensazione delle note di credito è solo un'INTENZIONE:
-- fattura e NC restano aperte. Questa migration registra QUALI NC vanno compensate su
-- QUALE fattura (tabella payable_credit_note_links, popolata dal frontend alla conferma)
-- e fa sì che, quando il movimento bancario NETTO viene riconciliato alla fattura, il
-- residuo dovuto alle NC venga azzerato consumando le NC collegate (chiuse in AVERE),
-- portando la fattura a 'pagato'. Così cassa (prima nota) e partitario restano coerenti
-- e non c'è doppio conteggio.
--
-- Inoltre estende reconcile_movement per agganciare un movimento a una fattura GIÀ chiusa
-- a mano (normalizzazione: se prima chiudi a mano e poi arriva il bonifico, non resta orfano).
--
-- CARATTERE: additiva e non distruttiva.
--   - nuova tabella payable_credit_note_links (con RLS)
--   - nuova funzione apply_credit_note_links()
--   - CREATE OR REPLACE di reconcile_movement / undo_reconcile_movement / try_match_bank_transaction
--     (nessuna modifica ai dati esistenti; solo logica)
--
-- ⚠️ REGOLA #0 — PARITÀ TENANT: applicare A MANO e IDENTICA su NZ + Made + Zago.
--   NZ   = xfvfxsvqpnpvibgeqpqp
--   Made = wdgoebzvosspjqttitra
--   Zago = jxlwvzjreukscnswkbjx
-- Rollback in coda al file. Verifiche (sola lettura) in coda al file.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) Tabella legame Fattura ↔ NC compensata
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payable_credit_note_links (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL,
  payable_id              uuid NOT NULL REFERENCES public.payables(id) ON DELETE CASCADE,
  credit_note_payable_id  uuid NOT NULL REFERENCES public.payables(id) ON DELETE CASCADE,
  amount                  numeric(14,2) NOT NULL DEFAULT 0,   -- importo NC compensato (valore assoluto)
  status                  text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','cancelled')),
  created_by              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  applied_at              timestamptz,
  CONSTRAINT uq_payable_nc_link UNIQUE (payable_id, credit_note_payable_id)
);

CREATE INDEX IF NOT EXISTS idx_pcnl_payable_pending ON public.payable_credit_note_links (payable_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pcnl_nc              ON public.payable_credit_note_links (credit_note_payable_id);
CREATE INDEX IF NOT EXISTS idx_pcnl_company         ON public.payable_credit_note_links (company_id);

-- RLS: isolamento azienda; scrittura ai ruoli operativi (come payables)
ALTER TABLE public.payable_credit_note_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pcnl_select" ON public.payable_credit_note_links;
CREATE POLICY "pcnl_select" ON public.payable_credit_note_links
  AS PERMISSIVE FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "pcnl_write" ON public.payable_credit_note_links;
CREATE POLICY "pcnl_write" ON public.payable_credit_note_links
  AS PERMISSIVE
  USING ((company_id = get_my_company_id())
         AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role])))
  WITH CHECK ((company_id = get_my_company_id())
         AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role])));

-- ---------------------------------------------------------------------
-- 2) Helper: applica le NC collegate a una fattura
--    Chiude in AVERE le NC 'pending' collegate (come "Chiudi a mano"), marca i link
--    'applied' e ritorna il totale NC applicato. Idempotente: agisce solo su link
--    'pending' con NC ancora aperta. NON riduce di per sé il residuo del payable:
--    è il chiamante (reconcile_movement) a ricalcolarlo.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_credit_note_links(p_payable_id uuid, p_close_date date DEFAULT CURRENT_DATE)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link RECORD;
  v_nc   RECORD;
  v_inv  text;
  v_total numeric := 0;
BEGIN
  SELECT invoice_number INTO v_inv FROM public.payables WHERE id = p_payable_id;

  FOR v_link IN
    SELECT * FROM public.payable_credit_note_links
    WHERE payable_id = p_payable_id AND status = 'pending'
    ORDER BY created_at
  LOOP
    SELECT * INTO v_nc FROM public.payables WHERE id = v_link.credit_note_payable_id;

    -- NC non più disponibile (già compensata a mano o sparita): annullo il link e proseguo
    IF v_nc IS NULL OR COALESCE(v_nc.closed_manually, false) THEN
      UPDATE public.payable_credit_note_links SET status = 'cancelled', applied_at = now() WHERE id = v_link.id;
      CONTINUE;
    END IF;

    -- Chiudo la NC in AVERE (resta status 'nota_credito', come "Chiudi a mano")
    UPDATE public.payables
    SET closed_manually = true,
        payment_date = p_close_date,
        payment_bank_account_id = null,
        updated_at = now()
    WHERE id = v_nc.id;

    INSERT INTO public.payable_actions (payable_id, action_type, amount, bank_account_id, note, performed_at)
    VALUES (v_nc.id, 'chiusura_manuale', abs(COALESCE(v_nc.gross_amount, 0)), null,
            'Compensata in riconciliazione su fattura ' || COALESCE(v_inv, '') || ' (registrata in AVERE)',
            now());

    UPDATE public.payable_credit_note_links SET status = 'applied', applied_at = now() WHERE id = v_link.id;
    v_total := v_total + abs(COALESCE(v_nc.gross_amount, 0));
  END LOOP;

  RETURN v_total;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_credit_note_links(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_credit_note_links(uuid, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3) reconcile_movement (CREATE OR REPLACE) — base migrazione 064 + 2 novità:
--    (A) "aggancio a fattura chiusa a mano" (link-only, nessuna doppia scrittura)
--    (B) consumo delle NC collegate se resta un residuo → fattura 'pagato'
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_movement(p_bt_id uuid, p_payable_id uuid, p_log_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bt RECORD;
  v_pay RECORD;
  v_log RECORD;
  v_remaining NUMERIC;
  v_applied NUMERIC;
  v_nc_applied NUMERIC := 0;
  v_new_remaining NUMERIC;
  v_new_status payable_status;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL THEN
    RAISE EXCEPTION 'Movimento bancario non trovato';
  END IF;

  SELECT * INTO v_pay FROM public.payables WHERE id = p_payable_id;
  IF v_pay IS NULL THEN
    RAISE EXCEPTION 'Fattura non trovata';
  END IF;

  IF v_bt.company_id IS DISTINCT FROM v_pay.company_id THEN
    RAISE EXCEPTION 'Movimento e fattura appartengono ad aziende diverse';
  END IF;

  -- Riga di log da confermare: dev'essere ancora 'to_confirm'
  IF p_log_id IS NOT NULL THEN
    SELECT * INTO v_log FROM public.reconciliation_log WHERE id = p_log_id;
    IF v_log IS NULL OR v_log.status <> 'to_confirm' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'stale');
    END IF;
  END IF;

  -- Movimento già riconciliato → stantio
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stale');
  END IF;

  -- (A) NOVITÀ: fattura GIÀ chiusa a mano e senza movimento agganciato (normalizzazione).
  -- Non tocco importi/stato: aggancio SOLO il movimento, così non resta orfano né si duplica.
  IF v_pay.status = 'pagato' AND COALESCE(v_pay.closed_manually, false) AND v_pay.bank_transaction_id IS NULL THEN
    UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = p_payable_id;
    UPDATE public.bank_transactions
      SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = p_payable_id
      WHERE id = p_bt_id;
    IF p_log_id IS NOT NULL THEN
      UPDATE public.reconciliation_log
        SET status = 'applied', applied_amount = abs(v_bt.amount), confirmed_at = now(),
            notes = COALESCE(notes, '') || ' | agganciato a fattura chiusa a mano'
        WHERE id = p_log_id;
    ELSE
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_pay.company_id, p_bt_id, p_payable_id, 'manual', 100, 'applied', abs(v_bt.amount),
              'aggancio a fattura chiusa a mano (nessuna doppia scrittura)');
    END IF;
    RETURN jsonb_build_object('ok', true, 'linked_only', true, 'payable_id', p_payable_id, 'bank_transaction_id', p_bt_id);
  END IF;

  v_remaining := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);

  -- Condizioni stantie: fattura già chiusa/non abbinabile o niente da applicare
  IF v_pay.status IN ('pagato', 'annullato', 'nota_credito') OR v_remaining <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stale');
  END IF;

  v_applied := LEAST(abs(v_bt.amount), v_remaining);
  v_new_remaining := v_remaining - v_applied;

  UPDATE public.payables
  SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
      amount_remaining = v_new_remaining,
      payment_date = v_bt.transaction_date,
      bank_transaction_id = p_bt_id,
      updated_at = now()
  WHERE id = p_payable_id;

  -- (B) NOVITÀ: se resta un residuo, provo a compensarlo con le NC collegate in distinta.
  IF v_new_remaining > 0 THEN
    v_nc_applied := public.apply_credit_note_links(p_payable_id, v_bt.transaction_date);
    IF v_nc_applied > 0 THEN
      v_new_remaining := GREATEST(0, v_new_remaining - v_nc_applied);
      UPDATE public.payables SET amount_remaining = v_new_remaining, updated_at = now() WHERE id = p_payable_id;
    END IF;
  END IF;

  v_new_status := CASE WHEN v_new_remaining <= 0 THEN 'pagato'::payable_status ELSE 'parziale'::payable_status END;
  UPDATE public.payables SET status = v_new_status, updated_at = now() WHERE id = p_payable_id;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = p_payable_id
  WHERE id = p_bt_id;

  IF p_log_id IS NOT NULL THEN
    UPDATE public.reconciliation_log
      SET status = 'applied', applied_amount = v_applied, confirmed_at = now(),
          notes = COALESCE(notes, '') || ' | confermato manualmente'
                  || CASE WHEN v_nc_applied > 0 THEN ' + NC compensate ' || v_nc_applied ELSE '' END
      WHERE id = p_log_id;
  ELSE
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
    VALUES (v_pay.company_id, p_bt_id, p_payable_id, 'manual', 100, 'applied', v_applied,
            'abbinamento manuale via reconcile_movement'
            || CASE WHEN v_nc_applied > 0 THEN ' (+ NC compensate ' || v_nc_applied || ')' ELSE '' END);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'payable_id', p_payable_id,
    'bank_transaction_id', p_bt_id,
    'applied', v_applied,
    'nc_applied', v_nc_applied,
    'amount_remaining', v_new_remaining,
    'status', v_new_status
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reconcile_movement(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_movement(uuid, uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4) undo_reconcile_movement (CREATE OR REPLACE) — base 064 + riapertura NC collegate.
--    Annullando una riconciliazione che aveva compensato NC, riapro le NC (link → pending)
--    e ripristino il residuo della fattura anche della quota NC.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.undo_reconcile_movement(p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log RECORD;
  v_pay RECORD;
  v_link RECORD;
  v_nc_restored NUMERIC := 0;
  v_new_paid NUMERIC;
  v_new_remaining NUMERIC;
  v_new_status payable_status;
  v_fully_open BOOLEAN;
BEGIN
  SELECT * INTO v_log FROM public.reconciliation_log WHERE id = p_log_id;
  IF v_log IS NULL OR v_log.status <> 'applied' OR v_log.applied_amount IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_applicable');
  END IF;

  SELECT * INTO v_pay FROM public.payables WHERE id = v_log.payable_id;
  IF v_pay IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payable_not_found');
  END IF;

  -- NOVITÀ: riapri le NC compensate su questa fattura (link 'applied' → 'pending')
  FOR v_link IN
    SELECT * FROM public.payable_credit_note_links
    WHERE payable_id = v_pay.id AND status = 'applied'
  LOOP
    UPDATE public.payables
    SET closed_manually = false, payment_date = NULL, updated_at = now()
    WHERE id = v_link.credit_note_payable_id;

    INSERT INTO public.payable_actions (payable_id, action_type, amount, bank_account_id, note, performed_at)
    VALUES (v_link.credit_note_payable_id, 'chiusura_manuale', 0, null,
            'Riapertura NC: annullata la riconciliazione della fattura collegata', now());

    UPDATE public.payable_credit_note_links SET status = 'pending', applied_at = NULL WHERE id = v_link.id;
    v_nc_restored := v_nc_restored + COALESCE(v_link.amount, 0);
  END LOOP;

  v_new_paid := GREATEST(0, COALESCE(v_pay.amount_paid, 0) - v_log.applied_amount);
  v_new_remaining := COALESCE(v_pay.amount_remaining, 0) + v_log.applied_amount + v_nc_restored;
  v_fully_open := v_new_paid <= 0;
  v_new_status := CASE
    WHEN v_fully_open THEN
      CASE WHEN v_pay.due_date IS NOT NULL AND v_pay.due_date < CURRENT_DATE
           THEN 'scaduto'::payable_status ELSE 'da_pagare'::payable_status END
    ELSE 'parziale'::payable_status
  END;

  UPDATE public.payables
  SET amount_paid = v_new_paid,
      amount_remaining = v_new_remaining,
      status = v_new_status,
      payment_date = CASE WHEN v_fully_open THEN NULL ELSE payment_date END,
      bank_transaction_id = CASE WHEN v_fully_open THEN NULL ELSE bank_transaction_id END,
      updated_at = now()
  WHERE id = v_pay.id;

  IF v_log.bank_transaction_id IS NOT NULL THEN
    UPDATE public.bank_transactions
    SET is_reconciled = false, reconciled_at = NULL, reconciled_invoice_id = NULL
    WHERE id = v_log.bank_transaction_id;
  END IF;

  UPDATE public.reconciliation_log
  SET status = 'rejected',
      notes = COALESCE(notes, '') || ' | annullato manualmente il ' || to_char(now(), 'DD/MM/YYYY')
  WHERE id = p_log_id;

  RETURN jsonb_build_object(
    'ok', true,
    'payable_id', v_pay.id,
    'restored_remaining', v_new_remaining,
    'nc_restored', v_nc_restored,
    'status', v_new_status
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.undo_reconcile_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_reconcile_movement(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5) try_match_bank_transaction (CREATE OR REPLACE) — base 063 + UNA guardia:
--    escludo dall'auto-match le fatture con NC collegate 'pending'. Quelle vanno
--    riconciliate a mano (il bonifico è NETTO ≠ lordo fattura), dove reconcile_movement
--    consuma le NC. Così evito auto-abbinamenti errati sull'importo lordo.
--    Il resto della logica (score/soglie) è INVARIATO rispetto alla 063.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_match_bank_transaction(p_bt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bt RECORD;
  v_pay RECORD;
  v_best_payable_id UUID;
  v_best_score NUMERIC := 0;
  v_best_amount NUMERIC := 0;
  v_best_name NUMERIC := 0;
  v_best_date NUMERIC := 0;
  v_score_amount NUMERIC;
  v_score_name NUMERIC;
  v_score_date NUMERIC;
  v_score_total NUMERIC;
  v_bank_bonus NUMERIC;
  v_amount_diff_pct NUMERIC;
  v_days_diff INTEGER;
  v_match_type TEXT;
  v_log_status TEXT;
  v_descr TEXT;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'amount_not_negative_or_tx_not_found');
  END IF;

  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));

  FOR v_pay IN
    SELECT * FROM public.payables
    WHERE company_id = v_bt.company_id
      AND status IN ('da_pagare', 'in_scadenza', 'scaduto')
      AND bank_transaction_id IS NULL
      AND gross_amount > 0
      -- NOVITÀ 090: escludo le fatture con NC collegate pending (bonifico netto ≠ lordo → match manuale)
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = payables.id AND l.status = 'pending'
      )
  LOOP
    -- Asse importo (50pt)
    v_amount_diff_pct := abs(abs(v_bt.amount) - v_pay.gross_amount) / v_pay.gross_amount * 100;
    v_score_amount := GREATEST(0, 50 - v_amount_diff_pct * 5);

    -- Asse nome (30pt)
    v_score_name := 0;
    IF v_pay.supplier_vat IS NOT NULL AND v_descr LIKE '%' || lower(v_pay.supplier_vat) || '%' THEN
      v_score_name := 30;
    ELSIF v_pay.supplier_name IS NOT NULL AND v_descr LIKE '%' || lower(v_pay.supplier_name) || '%' THEN
      v_score_name := 25;
    ELSIF v_pay.supplier_name IS NOT NULL THEN
      v_score_name := similarity(v_descr, lower(v_pay.supplier_name)) * 30;
    END IF;

    -- Asse data (20pt): se due_date NULL non azzerare lo score complessivo -> 0pt su questo asse
    IF v_pay.due_date IS NULL THEN
      v_score_date := 0;
    ELSE
      v_days_diff := abs(v_bt.transaction_date - v_pay.due_date);
      v_score_date := GREATEST(0, 20 - v_days_diff);
    END IF;

    -- Bonus banca attesa (+10)
    v_bank_bonus := 0;
    IF v_pay.payment_bank_account_id IS NOT NULL
       AND v_pay.payment_bank_account_id = v_bt.bank_account_id THEN
      v_bank_bonus := 10;
    END IF;

    v_score_total := LEAST(100, v_score_amount + v_score_name + v_score_date + v_bank_bonus);

    IF v_score_total > v_best_score THEN
      v_best_score := v_score_total;
      v_best_payable_id := v_pay.id;
      v_best_amount := v_score_amount;
      v_best_name := v_score_name;
      v_best_date := v_score_date;
    END IF;
  END LOOP;

  IF v_best_payable_id IS NULL OR v_best_score < 50 THEN
    RETURN jsonb_build_object('matched', false, 'best_score', v_best_score);
  END IF;

  IF v_best_score >= 80 THEN
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
    'auto-generated by try_match_bank_transaction'
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
    'applied', v_match_type = 'auto_exact'
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.try_match_bank_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_match_bank_transaction(uuid) TO authenticated, service_role;

COMMIT;

-- =====================================================================
-- ROLLBACK (eseguire a mano se serve tornare indietro)
-- =====================================================================
-- BEGIN;
--   -- Ripristina le 3 funzioni alla versione 063/064 (ri-applicare i file
--   --   20260611_063_reconcile_rpc_and_status_fix.sql e 20260611_064_reconciliation_confirm_undo.sql)
--   DROP FUNCTION IF EXISTS public.apply_credit_note_links(uuid, date);
--   DROP TABLE IF EXISTS public.payable_credit_note_links;  -- ⚠️ cancella i legami NC↔fattura registrati
-- COMMIT;

-- =====================================================================
-- VERIFICHE (sola lettura, dopo l'applicazione)
-- =====================================================================
-- 1) Tabella e RLS presenti:
--    SELECT relrowsecurity FROM pg_class WHERE relname='payable_credit_note_links';
--    SELECT polname FROM pg_policies WHERE tablename='payable_credit_note_links';
-- 2) Funzioni aggiornate senza errori:
--    SELECT proname FROM pg_proc WHERE proname IN
--      ('apply_credit_note_links','reconcile_movement','undo_reconcile_movement','try_match_bank_transaction');
-- 3) Simulazione (in una tx da annullare) su una fattura con NC collegata:
--    -- inserire un link pending, riconciliare un movimento netto, verificare che la fattura
--    -- diventi 'pagato' e le NC risultino closed_manually, poi ROLLBACK.
-- =====================================================================
