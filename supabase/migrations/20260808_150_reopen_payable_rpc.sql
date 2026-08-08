-- Migrazione 150 — RPC atomica per RIAPRIRE una scadenza chiusa per errore.
--
-- MOTIVO (richiesta Patrizio): capita che una fattura venga chiusa a mano per
-- sbaglio, oppure che il motore di riconciliazione l'abbia "incrociata male"
-- (agganciata al movimento bancario sbagliato). Serve un modo semplice e
-- REVERSIBILE per riportarla allo stato aperto, dal menu azioni dello Scadenzario.
--
-- COSA FA `reopen_payable(p_id, p_reason, p_operator)`:
--   1. Blocca la riga (SELECT ... FOR UPDATE) e legge i valori FRESCHI (anti
--      lost-update, come close_payable_manually).
--   2. Se la scadenza NON risulta chiusa -> no-op (reopened=false), nessuna scrittura.
--   3. Riapre le note di credito COMPENSATE su questa fattura (link 'applied' ->
--      'pending'): la NC torna disponibile (closed_manually=false).
--   4. LIBERA i movimenti bancari agganciati a questa fattura
--      (payables.bank_transaction_id e bank_transactions.reconciled_invoice_id):
--      is_reconciled=false -> il movimento torna nella coda "da riconciliare" e
--      l'operatrice puo' riagganciarlo alla fattura GIUSTA. Marca i relativi
--      reconciliation_log 'applied' come 'rejected'.
--   5. Azzera il pagato residuo e i flag di chiusura (amount_paid, closed_manually,
--      manual_close_reason, payment_date, is_provisional_paid, provisional_paid_at).
--      Il trigger update_payable_status ricalcola amount_remaining e riporta lo
--      stato a da_pagare / scaduto / in_scadenza (o resta nota_credito per le NC).
--   6. Scrive SEMPRE una riga di audit in payable_actions (action_type='riapertura').
--   7. Restituisce i valori autorevoli + n° movimenti liberati + n° NC riaperte.
--
-- NB: la RPC e' AUTOSUFFICIENTE (non delega a undo_reconcile_movement) perche' i
-- log storici dei matcher automatici hanno spesso applied_amount NULL, per cui la
-- undo sarebbe un no-op e lascerebbe il movimento agganciato. Qui si parte
-- dall'aggancio bank_transaction_id (fonte di verita') e si libera comunque.
--
-- CARATTERE: additivo (CREATE OR REPLACE FUNCTION), NESSUN DELETE, tutto UPDATE
-- reversibile (le riconciliazioni si possono rifare, le NC tornano 'pending').
-- Nessun dato modificato dall'apply della migration in se'.
-- SICUREZZA: SECURITY INVOKER -> rispetta la RLS company-scoped di payables,
-- bank_transactions, reconciliation_log, payable_credit_note_links,
-- payable_actions (l'utente tocca solo le righe della propria azienda; un p_id di
-- un'altra azienda non e' visibile sotto RLS -> eccezione).
-- ⚠️ REGOLA #0 — PARITÀ TENANT: applicare su NZ + Made + Zago.

CREATE OR REPLACE FUNCTION public.reopen_payable(
  p_id uuid,
  p_reason text DEFAULT NULL,
  p_operator text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  status text,
  amount_paid numeric,
  amount_remaining numeric,
  payment_date date,
  closed_manually boolean,
  bank_transaction_id uuid,
  undone_reconciliations integer,
  reopened_credit_notes integer,
  reopened boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
-- Le colonne di output di RETURNS TABLE (status, closed_manually, ...) sono
-- variabili PL/pgSQL: in caso di ambiguita' con una colonna omonima, preferisci
-- la COLONNA (non tocco mai gli OUT per nome, li popolo solo via RETURN QUERY).
#variable_conflict use_column
DECLARE
  v_gross numeric;
  v_paid numeric;
  v_status text;
  v_closed boolean;
  v_prov boolean;
  v_bt uuid;
  v_is_nc boolean;
  v_reopenable boolean;
  v_link RECORD;
  v_bt_ids uuid[] := '{}';
  v_freed integer := 0;
  v_ncs integer := 0;
  v_note text;
BEGIN
  -- 1) Lock + lettura valori FRESCHI (anti lost-update).
  SELECT p.gross_amount, COALESCE(p.amount_paid, 0), p.status::text,
         COALESCE(p.closed_manually, false), COALESCE(p.is_provisional_paid, false),
         p.bank_transaction_id
    INTO v_gross, v_paid, v_status, v_closed, v_prov, v_bt
  FROM public.payables p
  WHERE p.id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payable % non trovato o non accessibile', p_id;
  END IF;

  v_is_nc := (v_status = 'nota_credito' OR v_gross < 0);

  -- 2) La scadenza risulta "chiusa" (quindi riapribile)?
  IF v_is_nc THEN
    v_reopenable := v_closed;
  ELSE
    v_reopenable := v_closed OR v_prov OR v_bt IS NOT NULL OR v_paid > 0
      OR v_status IN ('pagato', 'parziale')
      OR EXISTS (SELECT 1 FROM public.reconciliation_log rl
                 WHERE rl.payable_id = p_id AND rl.status = 'applied');
  END IF;

  IF NOT v_reopenable THEN
    -- Niente da riaprire: restituisco lo stato attuale senza scrivere nulla.
    RETURN QUERY
      SELECT p.id, p.status::text, p.amount_paid, p.amount_remaining,
             p.payment_date, p.closed_manually, p.bank_transaction_id,
             0, 0, false
      FROM public.payables p WHERE p.id = p_id;
    RETURN;
  END IF;

  -- 3) Riapri le note di credito compensate su questa fattura (link applied -> pending).
  FOR v_link IN
    SELECT l.* FROM public.payable_credit_note_links l
    WHERE l.payable_id = p_id AND l.status = 'applied'
  LOOP
    UPDATE public.payables
      SET closed_manually = false, payment_date = NULL, updated_at = now()
      WHERE id = v_link.credit_note_payable_id;

    INSERT INTO public.payable_actions
      (payable_id, action_type, amount, bank_account_id, note, operator_name, performed_at)
    VALUES
      (v_link.credit_note_payable_id, 'riapertura', COALESCE(v_link.amount, 0), NULL,
       'Riapertura NC: annullata la compensazione sulla fattura collegata', p_operator, now());

    UPDATE public.payable_credit_note_links
      SET status = 'pending', applied_at = NULL WHERE id = v_link.id;
    v_ncs := v_ncs + 1;
  END LOOP;

  -- 4) Raccogli e libera i movimenti bancari agganciati a questa fattura.
  SELECT array_agg(DISTINCT bt_id) INTO v_bt_ids
  FROM (
    SELECT v_bt AS bt_id WHERE v_bt IS NOT NULL
    UNION
    SELECT bt.id FROM public.bank_transactions bt WHERE bt.reconciled_invoice_id = p_id
    UNION
    SELECT rl.bank_transaction_id FROM public.reconciliation_log rl
      WHERE rl.payable_id = p_id AND rl.status = 'applied' AND rl.bank_transaction_id IS NOT NULL
  ) s
  WHERE s.bt_id IS NOT NULL;

  IF v_bt_ids IS NOT NULL AND array_length(v_bt_ids, 1) > 0 THEN
    UPDATE public.bank_transactions
      SET is_reconciled = false, reconciled_at = NULL, reconciled_invoice_id = NULL
      WHERE id = ANY(v_bt_ids);
    v_freed := array_length(v_bt_ids, 1);
  END IF;

  -- Marca i log 'applied' di questa fattura come 'rejected' (riapertura manuale).
  UPDATE public.reconciliation_log rl
    SET status = 'rejected',
        notes = COALESCE(rl.notes, '') || ' | fattura riaperta a mano il ' || to_char(now(), 'DD/MM/YYYY')
    WHERE rl.payable_id = p_id AND rl.status = 'applied';

  -- 5) Reset della fattura / NC.
  IF v_is_nc THEN
    -- Nota di credito: la riapertura toglie la chiusura manuale; lo stato resta NC.
    UPDATE public.payables SET
      closed_manually = false,
      manual_close_reason = NULL,
      payment_date = NULL,
      updated_at = now()
    WHERE public.payables.id = p_id;
  ELSE
    -- Fattura: azzera il pagato e i flag di chiusura. Il trigger
    -- update_payable_status ricalcola amount_remaining e lo stato da gross - amount_paid.
    UPDATE public.payables SET
      amount_paid = 0,
      payment_date = NULL,
      closed_manually = false,
      manual_close_reason = NULL,
      bank_transaction_id = NULL,
      is_provisional_paid = false,
      provisional_paid_at = NULL,
      updated_at = now()
    WHERE public.payables.id = p_id;
  END IF;

  -- 6) Audit sempre.
  v_note := 'Riaperta a mano il ' || to_char(CURRENT_DATE, 'DD/MM/YYYY')
    || CASE WHEN v_freed > 0
            THEN ' — liberati ' || v_freed || ' movimento/i bancario/i'
            ELSE '' END
    || CASE WHEN v_ncs > 0
            THEN ' — riaperte ' || v_ncs || ' nota/e di credito'
            ELSE '' END
    || COALESCE(' — ' || p_reason, '');

  INSERT INTO public.payable_actions
    (payable_id, action_type, amount, bank_account_id, note, operator_name, performed_at)
  VALUES
    (p_id, 'riapertura', NULL, NULL, v_note, p_operator, now());

  RETURN QUERY
    SELECT p.id, p.status::text, p.amount_paid, p.amount_remaining,
           p.payment_date, p.closed_manually, p.bank_transaction_id,
           v_freed, v_ncs, true
    FROM public.payables p WHERE p.id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_payable(uuid, text, text) TO authenticated;

-- Rollback: vedi 20260808_150_reopen_payable_rpc_ROLLBACK.sql
