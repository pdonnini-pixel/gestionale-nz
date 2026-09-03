-- =============================================================================
-- Migrazione 170 — «Compensa con nota di credito»: totale o PARZIALE, da
-- Scadenzario, senza movimento bancario, con credito residuo sulla NC.
-- =============================================================================
--
-- IL PROBLEMA (caso reale NZ, SERTEC 312 / NC 393, 03/09/2026): per chiudere
-- una fattura a fronte di una nota di credito senza bonifico servivano tre
-- passaggi a mano (Riapri, Chiudi a mano la fattura, Chiudi a mano la NC) e il
-- legame fattura↔NC non veniva scritto. Inoltre la NC era «tutto o niente»:
-- una NC piu' grande della fattura veniva chiusa per intero e l'eccedenza
-- spariva dal dovuto del fornitore (in distinta il netto viene tagliato a 0).
--
-- IL MODELLO. La quota di NC consumata si registra in payables.amount_paid
-- della NC, in NEGATIVO (stesso segno del lordo): il trigger update_payable_status
-- ricalcola amount_remaining = gross − amount_paid, quindi una NC da −3.000
-- usata per 500 ha amount_paid = −500 e amount_remaining = −2.500 = credito
-- ancora disponibile. Lo Scadenzario, la pagina Fornitori (payableOpenAmount) e
-- la distinta leggono gia' amount_remaining: il residuo si propaga da solo.
-- La NC si chiude (closed_manually + payment_date) SOLO quando il residuo
-- arriva a zero. Le NC chiuse in passato con amount_paid = 0 restano valide:
-- il residuo e' 0 perche' sono chiuse (helper credit_note_residual).
--
-- COSA C'E' QUI (tutto additivo, CREATE OR REPLACE, nessun dato toccato):
--   1. payable_credit_note_links.origin: da dove nasce il legame
--      ('compensazione' | 'distinta' | 'riba'; NULL = storico).
--   2. credit_note_residual(): residuo di una NC (0 se chiusa).
--   3. compensate_payable_with_credit_note(): la RPC nuova. Stesso fornitore,
--      importo = min(residuo fattura, residuo NC) se non indicato, clamp;
--      fattura → amount_paid += importo, chiusa a mano (pagato o parziale);
--      NC → amount_paid −= importo, chiusa solo a residuo zero; legame
--      'applied' (somma se gia' presente); audit su entrambe le righe; rifiuta
--      NC impegnate in distinta (link pending).
--   4. reopen_payable(): riapertura coerente col residuo. Fattura riaperta →
--      le NC compensate riprendono il credito (amount_paid risalito verso 0);
--      link 'compensazione' → cancelled, altri → pending (come prima).
--      NC riaperta → amount_paid = 0 e, per i legami 'compensazione'/'distinta',
--      le fatture tornano dovute per quella quota (link cancelled); i legami
--      RiBa e storici non toccano la fattura (come prima).
--   5. apply_credit_note_links() (riconciliazione): consuma min(residuo, quota
--      del legame) invece di chiudere sempre tutta la NC.
--   6. undo_reconcile_movement(): restituisce alla NC la quota consumata.
--   7. close_payable_manually(): per una NC l'audit riporta il residuo reale
--      (non il lordo) — chiudere a mano una NC = stralciare il residuo.
--   8. rpc_link_riba_credit_note(): usa il residuo e marca origin='riba'.
--
-- SICUREZZA: RPC nuova SECURITY INVOKER (RLS company-scoped di payables,
-- payable_credit_note_links, payable_actions). Le DEFINER esistenti restano
-- con REVOKE anon (migration 154), riaffermato qui.
-- ⚠️ REGOLA #0 — PARITÀ TENANT: applicare su NZ + Made + Zago.
-- Rollback: 20260903_170_credit_note_compensation_ROLLBACK.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Origine del legame fattura↔NC
-- ---------------------------------------------------------------------------
ALTER TABLE public.payable_credit_note_links
  ADD COLUMN IF NOT EXISTS origin text;

COMMENT ON COLUMN public.payable_credit_note_links.origin IS
  'Da dove nasce il legame: compensazione (RPC compensate_payable_with_credit_note), distinta (conferma distinta, poi consumato in riconciliazione), riba (abbinamento NC RiBa). NULL = storico.';

-- ---------------------------------------------------------------------------
-- 2) Residuo di una nota di credito (valore assoluto; 0 se chiusa)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_note_residual(
  p_gross numeric, p_paid numeric, p_closed boolean, p_payment_date date
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
           WHEN COALESCE(p_closed, false) OR p_payment_date IS NOT NULL THEN 0
           ELSE GREATEST(0, round(abs(COALESCE(p_gross, 0)) - abs(COALESCE(p_paid, 0)), 2))
         END
$$;

GRANT EXECUTE ON FUNCTION public.credit_note_residual(numeric, numeric, boolean, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) RPC: compensa una fattura con una nota di credito (totale o parziale)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compensate_payable_with_credit_note(
  p_payable_id uuid,
  p_credit_note_id uuid,
  p_amount numeric DEFAULT NULL,
  p_date date DEFAULT CURRENT_DATE,
  p_reason text DEFAULT NULL,
  p_operator text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_inv RECORD;
  v_nc RECORD;
  v_inv_res numeric;
  v_nc_res numeric;
  v_amt numeric;
  v_inv_new_paid numeric;
  v_inv_new_res numeric;
  v_nc_new_paid numeric;
  v_nc_new_res numeric;
  v_nc_closed boolean;
  v_link_id uuid;
  v_inv_after RECORD;
  v_nc_after RECORD;
  v_inv_ref text;
  v_nc_ref text;
  v_date_label text;
BEGIN
  IF p_payable_id IS NULL OR p_credit_note_id IS NULL THEN
    RAISE EXCEPTION 'Fattura e nota di credito sono obbligatorie';
  END IF;
  IF p_payable_id = p_credit_note_id THEN
    RAISE EXCEPTION 'Fattura e nota di credito coincidono';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'Data di compensazione obbligatoria';
  END IF;

  -- Lock di entrambe le righe in ordine stabile (anti-deadlock), valori FRESCHI.
  PERFORM 1 FROM public.payables p
    WHERE p.id IN (p_payable_id, p_credit_note_id)
    ORDER BY p.id FOR UPDATE;

  SELECT * INTO v_inv FROM public.payables WHERE id = p_payable_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fattura non trovata o non accessibile';
  END IF;
  SELECT * INTO v_nc FROM public.payables WHERE id = p_credit_note_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota di credito non trovata o non accessibile';
  END IF;

  IF v_inv.company_id IS DISTINCT FROM v_nc.company_id THEN
    RAISE EXCEPTION 'Fattura e nota di credito appartengono ad aziende diverse';
  END IF;
  IF NOT (v_nc.status::text = 'nota_credito' OR COALESCE(v_nc.gross_amount, 0) < 0) THEN
    RAISE EXCEPTION 'La riga scelta come nota di credito non e'' una nota di credito';
  END IF;
  IF v_inv.status::text = 'nota_credito' OR COALESCE(v_inv.gross_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'La riga da compensare non e'' una fattura';
  END IF;
  IF v_inv.status::text IN ('pagato', 'annullato', 'bloccato') THEN
    RAISE EXCEPTION 'La fattura non e'' aperta (stato: %)', v_inv.status;
  END IF;
  -- Stesso fornitore: per supplier_id oppure per P.IVA (regola PAYMENT_PLAN_NOTES)
  IF NOT (
       (v_inv.supplier_id IS NOT NULL AND v_inv.supplier_id = v_nc.supplier_id)
    OR (COALESCE(v_inv.supplier_vat, '') <> '' AND v_inv.supplier_vat = v_nc.supplier_vat)
  ) THEN
    RAISE EXCEPTION 'Fattura e nota di credito sono di fornitori diversi';
  END IF;
  -- NC gia' impegnata in una distinta in attesa di riconciliazione: non si tocca qui.
  IF EXISTS (SELECT 1 FROM public.payable_credit_note_links l
             WHERE l.credit_note_payable_id = p_credit_note_id AND l.status = 'pending') THEN
    RAISE EXCEPTION 'La nota di credito e'' gia'' impegnata in una distinta in attesa di riconciliazione';
  END IF;

  v_nc_res  := public.credit_note_residual(v_nc.gross_amount, v_nc.amount_paid, v_nc.closed_manually, v_nc.payment_date);
  v_inv_res := GREATEST(0, round(COALESCE(v_inv.gross_amount, 0) - COALESCE(v_inv.amount_paid, 0), 2));
  IF v_nc_res <= 0.005 THEN
    RAISE EXCEPTION 'La nota di credito non ha piu'' credito residuo';
  END IF;
  IF v_inv_res <= 0.005 THEN
    RAISE EXCEPTION 'La fattura non ha residuo da compensare';
  END IF;

  v_amt := COALESCE(p_amount, LEAST(v_inv_res, v_nc_res));
  IF v_amt <= 0 THEN
    RAISE EXCEPTION 'Importo di compensazione non valido';
  END IF;
  IF v_amt > LEAST(v_inv_res, v_nc_res) + 0.005 THEN
    RAISE EXCEPTION 'Importo % superiore al compensabile (residuo fattura %, credito NC %)',
      round(v_amt, 2), v_inv_res, v_nc_res;
  END IF;
  v_amt := round(LEAST(v_amt, v_inv_res, v_nc_res), 2);

  v_inv_ref := COALESCE(v_inv.invoice_number, '—');
  v_nc_ref := COALESCE(v_nc.invoice_number, '—');
  v_date_label := to_char(p_date, 'DD/MM/YYYY');

  -- Fattura: compensata = chiusa a mano (nessun movimento bancario), totale o parziale.
  v_inv_new_paid := round(COALESCE(v_inv.amount_paid, 0) + v_amt, 2);
  v_inv_new_res := GREATEST(0, round(COALESCE(v_inv.gross_amount, 0) - v_inv_new_paid, 2));
  UPDATE public.payables SET
    amount_paid = v_inv_new_paid,
    payment_date = p_date,
    closed_manually = true,
    manual_close_reason = COALESCE(NULLIF(btrim(p_reason), ''), 'Compensata con nota di credito ' || v_nc_ref),
    payment_bank_account_id = NULL,
    updated_at = now()
  WHERE id = p_payable_id;

  -- Nota di credito: consumo della quota (in negativo), chiusa solo a residuo zero.
  v_nc_new_paid := round(COALESCE(v_nc.amount_paid, 0) - v_amt, 2);
  v_nc_new_res := GREATEST(0, round(abs(COALESCE(v_nc.gross_amount, 0)) - abs(v_nc_new_paid), 2));
  v_nc_closed := v_nc_new_res <= 0.005;
  UPDATE public.payables SET
    amount_paid = v_nc_new_paid,
    closed_manually = v_nc_closed,
    payment_date = CASE WHEN v_nc_closed THEN p_date ELSE NULL END,
    manual_close_reason = CASE WHEN v_nc_closed THEN 'Compensata su fattura ' || v_inv_ref ELSE manual_close_reason END,
    payment_bank_account_id = NULL,
    updated_at = now()
  WHERE id = p_credit_note_id;

  -- Legame fattura↔NC (somma se la coppia esiste gia' come 'applied').
  INSERT INTO public.payable_credit_note_links
    (company_id, payable_id, credit_note_payable_id, amount, status, created_by, applied_at, origin)
  VALUES
    (v_inv.company_id, p_payable_id, p_credit_note_id, v_amt, 'applied', auth.uid(), now(), 'compensazione')
  ON CONFLICT (payable_id, credit_note_payable_id) DO UPDATE
    SET amount = CASE WHEN payable_credit_note_links.status = 'applied'
                      THEN round(payable_credit_note_links.amount + EXCLUDED.amount, 2)
                      ELSE EXCLUDED.amount END,
        status = 'applied',
        applied_at = now(),
        origin = 'compensazione'
  RETURNING id INTO v_link_id;

  -- Audit nel partitario, su entrambe le righe.
  INSERT INTO public.payable_actions
    (payable_id, action_type, amount, bank_account_id, note, operator_name, performed_at)
  VALUES
    (p_payable_id, 'compensazione_nc', v_amt, NULL,
     'Compensata con nota di credito ' || v_nc_ref || ' per ' || v_amt::text || ' il ' || v_date_label
       || CASE WHEN v_inv_new_res > 0.005 THEN ' — PARZIALE, residuo ' || v_inv_new_res::text ELSE '' END
       || COALESCE(' — ' || NULLIF(btrim(p_reason), ''), '')
       || ' (' || v_inv.status::text || ' → ' || CASE WHEN v_inv_new_res <= 0.005 THEN 'pagato' ELSE 'parziale' END || ')',
     p_operator, now()),
    (p_credit_note_id, 'compensazione_nc', v_amt, NULL,
     'Compensata sulla fattura ' || v_inv_ref || ' per ' || v_amt::text || ' il ' || v_date_label
       || ' (registrata in AVERE)'
       || CASE WHEN v_nc_closed THEN '' ELSE ' — credito residuo ' || v_nc_new_res::text END,
     p_operator, now());

  -- Una NC consumata del tutto non si abbina piu' a un movimento: proposte automatiche annullate.
  IF v_nc_closed THEN
    UPDATE public.reconciliation_log
      SET status = 'rejected',
          notes = COALESCE(notes, '') || ' | NC compensata sulla fattura ' || v_inv_ref || ' il ' || v_date_label
      WHERE payable_id = p_credit_note_id AND status = 'to_confirm';
  END IF;

  SELECT * INTO v_inv_after FROM public.payables WHERE id = p_payable_id;
  SELECT * INTO v_nc_after FROM public.payables WHERE id = p_credit_note_id;

  RETURN jsonb_build_object(
    'ok', true,
    'amount', v_amt,
    'link_id', v_link_id,
    'invoice', jsonb_build_object(
      'id', v_inv_after.id, 'status', v_inv_after.status,
      'amount_paid', v_inv_after.amount_paid, 'amount_remaining', v_inv_after.amount_remaining,
      'payment_date', v_inv_after.payment_date, 'closed_manually', v_inv_after.closed_manually,
      'manual_close_reason', v_inv_after.manual_close_reason),
    'credit_note', jsonb_build_object(
      'id', v_nc_after.id, 'status', v_nc_after.status,
      'amount_paid', v_nc_after.amount_paid, 'amount_remaining', v_nc_after.amount_remaining,
      'payment_date', v_nc_after.payment_date, 'closed_manually', v_nc_after.closed_manually,
      'manual_close_reason', v_nc_after.manual_close_reason, 'residual', v_nc_new_res)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compensate_payable_with_credit_note(uuid, uuid, numeric, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compensate_payable_with_credit_note(uuid, uuid, numeric, date, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) reopen_payable — riapertura coerente col credito residuo
--    (base: migration 150; stessa firma e stesso RETURNS TABLE)
-- ---------------------------------------------------------------------------
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
  v_ref text;
  v_inv_paid numeric;
BEGIN
  -- 1) Lock + lettura valori FRESCHI (anti lost-update).
  SELECT p.gross_amount, COALESCE(p.amount_paid, 0), p.status::text,
         COALESCE(p.closed_manually, false), COALESCE(p.is_provisional_paid, false),
         p.bank_transaction_id, COALESCE(p.invoice_number, '—')
    INTO v_gross, v_paid, v_status, v_closed, v_prov, v_bt, v_ref
  FROM public.payables p
  WHERE p.id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payable % non trovato o non accessibile', p_id;
  END IF;

  v_is_nc := (v_status = 'nota_credito' OR v_gross < 0);

  -- 2) La scadenza risulta "chiusa" (quindi riapribile)?
  IF v_is_nc THEN
    -- NC: chiusa a mano OPPURE con una quota gia' consumata in compensazione.
    v_reopenable := v_closed OR abs(v_paid) > 0.005;
  ELSE
    v_reopenable := v_closed OR v_prov OR v_bt IS NOT NULL OR v_paid > 0
      OR v_status IN ('pagato', 'parziale')
      OR EXISTS (SELECT 1 FROM public.reconciliation_log rl
                 WHERE rl.payable_id = p_id AND rl.status = 'applied');
  END IF;

  IF NOT v_reopenable THEN
    RETURN QUERY
      SELECT p.id, p.status::text, p.amount_paid, p.amount_remaining,
             p.payment_date, p.closed_manually, p.bank_transaction_id,
             0, 0, false
      FROM public.payables p WHERE p.id = p_id;
    RETURN;
  END IF;

  IF v_is_nc THEN
    -- 3-NC) Riapertura di una NOTA DI CREDITO: torna credito pieno. Le fatture
    -- compensate con questa NC ('compensazione' o 'distinta') tornano dovute per
    -- la quota; i legami RiBa e storici (origin NULL) non toccano la fattura.
    FOR v_link IN
      SELECT l.* FROM public.payable_credit_note_links l
      WHERE l.credit_note_payable_id = p_id AND l.status = 'applied'
    LOOP
      IF v_link.origin IN ('compensazione', 'distinta') AND COALESCE(v_link.amount, 0) > 0 THEN
        UPDATE public.payables
          SET amount_paid = GREATEST(0, round(COALESCE(amount_paid, 0) - v_link.amount, 2)),
              updated_at = now()
          WHERE public.payables.id = v_link.payable_id
          RETURNING public.payables.amount_paid INTO v_inv_paid;
        IF v_inv_paid <= 0.005 THEN
          UPDATE public.payables
            SET closed_manually = false, manual_close_reason = NULL,
                payment_date = CASE WHEN bank_transaction_id IS NULL THEN NULL ELSE payment_date END
            WHERE public.payables.id = v_link.payable_id;
        END IF;
        INSERT INTO public.payable_actions
          (payable_id, action_type, amount, bank_account_id, note, operator_name, performed_at)
        VALUES
          (v_link.payable_id, 'riapertura', v_link.amount, NULL,
           'Riaperta la nota di credito ' || v_ref || ': tolta la compensazione di ' || v_link.amount::text
             || ' — la fattura torna dovuta per questa quota', p_operator, now());
        v_ncs := v_ncs + 1;
      END IF;
      UPDATE public.payable_credit_note_links
        SET status = 'cancelled', applied_at = NULL WHERE public.payable_credit_note_links.id = v_link.id;
    END LOOP;

    UPDATE public.payables SET
      amount_paid = 0,
      closed_manually = false,
      manual_close_reason = NULL,
      payment_date = NULL,
      updated_at = now()
    WHERE public.payables.id = p_id;

    v_note := 'Riaperta a mano il ' || to_char(CURRENT_DATE, 'DD/MM/YYYY')
      || CASE WHEN v_ncs > 0 THEN ' — tolta la compensazione su ' || v_ncs || ' fattura/e' ELSE '' END
      || COALESCE(' — ' || p_reason, '');
    INSERT INTO public.payable_actions
      (payable_id, action_type, amount, bank_account_id, note, operator_name, performed_at)
    VALUES (p_id, 'riapertura', NULL, NULL, v_note, p_operator, now());

    RETURN QUERY
      SELECT p.id, p.status::text, p.amount_paid, p.amount_remaining,
             p.payment_date, p.closed_manually, p.bank_transaction_id,
             0, v_ncs, true
      FROM public.payables p WHERE p.id = p_id;
    RETURN;
  END IF;

  -- 3) Fattura: le NC compensate riprendono il credito (quota risalita verso 0).
  FOR v_link IN
    SELECT l.* FROM public.payable_credit_note_links l
    WHERE l.payable_id = p_id AND l.status = 'applied'
  LOOP
    UPDATE public.payables
      SET amount_paid = LEAST(0, round(COALESCE(amount_paid, 0) + COALESCE(v_link.amount, 0), 2)),
          closed_manually = false,
          payment_date = NULL,
          manual_close_reason = NULL,
          updated_at = now()
      WHERE public.payables.id = v_link.credit_note_payable_id;

    INSERT INTO public.payable_actions
      (payable_id, action_type, amount, bank_account_id, note, operator_name, performed_at)
    VALUES
      (v_link.credit_note_payable_id, 'riapertura', COALESCE(v_link.amount, 0), NULL,
       'Riapertura NC: annullata la compensazione sulla fattura ' || v_ref, p_operator, now());

    UPDATE public.payable_credit_note_links
      SET status = CASE WHEN origin = 'compensazione' THEN 'cancelled' ELSE 'pending' END,
          applied_at = NULL
      WHERE public.payable_credit_note_links.id = v_link.id;
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
      WHERE public.bank_transactions.id = ANY(v_bt_ids);
    v_freed := array_length(v_bt_ids, 1);
  END IF;

  UPDATE public.reconciliation_log rl
    SET status = 'rejected',
        notes = COALESCE(rl.notes, '') || ' | fattura riaperta a mano il ' || to_char(now(), 'DD/MM/YYYY')
    WHERE rl.payable_id = p_id AND rl.status = 'applied';

  -- 5) Reset della fattura.
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

-- ---------------------------------------------------------------------------
-- 5) apply_credit_note_links — consuma la quota del legame, non tutta la NC
--    (base: migration 090; stessa firma)
-- ---------------------------------------------------------------------------
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
  v_res  numeric;
  v_use  numeric;
  v_new_paid numeric;
  v_closed boolean;
  v_total numeric := 0;
BEGIN
  SELECT invoice_number INTO v_inv FROM public.payables WHERE id = p_payable_id;

  FOR v_link IN
    SELECT * FROM public.payable_credit_note_links
    WHERE payable_id = p_payable_id AND status = 'pending'
    ORDER BY created_at
  LOOP
    SELECT * INTO v_nc FROM public.payables WHERE id = v_link.credit_note_payable_id;
    v_res := CASE WHEN v_nc IS NULL THEN 0
                  ELSE public.credit_note_residual(v_nc.gross_amount, v_nc.amount_paid, v_nc.closed_manually, v_nc.payment_date) END;

    -- NC non piu' disponibile (chiusa/consumata/sparita): annullo il link e proseguo
    IF v_res <= 0.005 THEN
      UPDATE public.payable_credit_note_links SET status = 'cancelled', applied_at = now() WHERE id = v_link.id;
      CONTINUE;
    END IF;

    -- Quota da consumare: il legame (se valorizzato) entro il residuo reale della NC.
    v_use := round(LEAST(v_res, COALESCE(NULLIF(v_link.amount, 0), v_res)), 2);
    v_new_paid := round(COALESCE(v_nc.amount_paid, 0) - v_use, 2);
    v_closed := (abs(COALESCE(v_nc.gross_amount, 0)) - abs(v_new_paid)) <= 0.005;

    UPDATE public.payables
    SET amount_paid = v_new_paid,
        closed_manually = v_closed,
        payment_date = CASE WHEN v_closed THEN p_close_date ELSE NULL END,
        payment_bank_account_id = null,
        updated_at = now()
    WHERE id = v_nc.id;

    INSERT INTO public.payable_actions (payable_id, action_type, amount, bank_account_id, note, performed_at)
    VALUES (v_nc.id, 'chiusura_manuale', v_use, null,
            'Compensata in riconciliazione su fattura ' || COALESCE(v_inv, '') || ' (registrata in AVERE)'
              || CASE WHEN v_closed THEN '' ELSE ' — credito residuo ' || round(v_res - v_use, 2)::text END,
            now());

    UPDATE public.payable_credit_note_links
      SET status = 'applied', applied_at = now(), amount = v_use,
          origin = COALESCE(origin, 'distinta')
      WHERE id = v_link.id;
    v_total := v_total + v_use;
  END LOOP;

  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_credit_note_links(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_credit_note_links(uuid, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) undo_reconcile_movement — la NC riprende la quota consumata
--    (base: migration 090; unica modifica nel loop sui link)
-- ---------------------------------------------------------------------------
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

  -- Riapri le NC compensate su questa fattura (link 'applied' → 'pending'): la NC
  -- riprende la quota consumata (amount_paid risale verso 0) e torna disponibile.
  FOR v_link IN
    SELECT * FROM public.payable_credit_note_links
    WHERE payable_id = v_pay.id AND status = 'applied'
  LOOP
    UPDATE public.payables
    SET closed_manually = false, payment_date = NULL,
        amount_paid = LEAST(0, round(COALESCE(amount_paid, 0) + COALESCE(v_link.amount, 0), 2)),
        updated_at = now()
    WHERE id = v_link.credit_note_payable_id;

    INSERT INTO public.payable_actions (payable_id, action_type, amount, bank_account_id, note, performed_at)
    VALUES (v_link.credit_note_payable_id, 'chiusura_manuale', 0, null,
            'Riapertura NC: annullata la riconciliazione della fattura collegata', now());

    UPDATE public.payable_credit_note_links SET status = 'pending', applied_at = NULL WHERE id = v_link.id;
    v_nc_restored := v_nc_restored + COALESCE(v_link.amount, 0);
  END LOOP;

  v_new_paid := GREATEST(0, COALESCE(v_pay.amount_paid, 0) - v_log.applied_amount - v_nc_restored);
  v_fully_open := v_new_paid <= 0;

  UPDATE public.payables
  SET amount_paid = v_new_paid,
      payment_date = CASE WHEN v_fully_open THEN NULL ELSE payment_date END,
      bank_transaction_id = CASE WHEN v_fully_open THEN NULL ELSE bank_transaction_id END,
      updated_at = now()
  WHERE id = v_pay.id;

  SELECT amount_remaining, status INTO v_new_remaining, v_new_status FROM public.payables WHERE id = v_pay.id;

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
REVOKE ALL ON FUNCTION public.undo_reconcile_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_reconcile_movement(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) close_payable_manually — per una NC l'audit riporta il residuo reale
--    (base: migration 109; stessa firma e stesso RETURNS TABLE)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_payable_manually(
  p_id uuid,
  p_close_date date,
  p_reason text DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_operator text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  status text,
  amount_paid numeric,
  amount_remaining numeric,
  payment_date date,
  closed_manually boolean,
  manual_close_reason text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_gross numeric;
  v_paid numeric;
  v_status text;
  v_closed boolean;
  v_pdate date;
  v_remaining numeric;
  v_amount numeric;
  v_new_paid numeric;
  v_new_remaining numeric;
  v_new_status text;
  v_date_label text;
  v_note text;
BEGIN
  SELECT p.gross_amount, COALESCE(p.amount_paid, 0), p.status::text,
         COALESCE(p.closed_manually, false), p.payment_date
    INTO v_gross, v_paid, v_status, v_closed, v_pdate
  FROM public.payables p
  WHERE p.id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payable % non trovato o non accessibile', p_id;
  END IF;

  v_date_label := to_char(p_close_date, 'DD/MM/YYYY');

  -- ───── NOTA DI CREDITO ─────
  -- Chiudere a mano una NC = stralciare il credito RESIDUO (non consumato).
  IF v_status = 'nota_credito' OR v_gross < 0 THEN
    v_remaining := public.credit_note_residual(v_gross, v_paid, v_closed, v_pdate);

    UPDATE public.payables SET
      payment_date = p_close_date,
      closed_manually = true,
      manual_close_reason = p_reason,
      payment_bank_account_id = NULL
    WHERE public.payables.id = p_id;

    INSERT INTO public.payable_actions
      (payable_id, action_type, amount, bank_account_id, note, operator_name, performed_at)
    VALUES
      (p_id, 'chiusura_manuale', v_remaining, NULL,
       'Chiusura nota di credito a mano il ' || v_date_label
         || COALESCE(' — ' || p_reason, '') || ' (registrata in AVERE)',
       p_operator, now());

    RETURN QUERY
      SELECT p.id, p.status::text, p.amount_paid, p.amount_remaining,
             p.payment_date, p.closed_manually, p.manual_close_reason
      FROM public.payables p WHERE p.id = p_id;
    RETURN;
  END IF;

  -- ───── Fattura normale ─────
  v_remaining := GREATEST(0, v_gross - v_paid);
  v_amount := COALESCE(p_amount, v_remaining);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Importo di chiusura non valido';
  END IF;
  IF v_amount > v_remaining + 0.005 THEN
    v_amount := v_remaining;
  END IF;

  v_new_paid := v_paid + v_amount;
  v_new_remaining := GREATEST(0, v_remaining - v_amount);
  v_new_status := CASE WHEN v_new_remaining <= 0.005 THEN 'pagato' ELSE 'parziale' END;

  UPDATE public.payables SET
    status = v_new_status::payable_status,
    payment_date = p_close_date,
    amount_paid = v_new_paid,
    amount_remaining = v_new_remaining,
    closed_manually = true,
    manual_close_reason = p_reason,
    payment_bank_account_id = NULL
  WHERE public.payables.id = p_id;

  v_note := 'Chiusa a mano il ' || v_date_label
    || CASE WHEN v_new_remaining <= 0.005 THEN '' ELSE ' — PARZIALE' END
    || COALESCE(' — ' || p_reason, '')
    || ' (' || COALESCE(v_status, '—') || ' → ' || v_new_status || ')';

  INSERT INTO public.payable_actions
    (payable_id, action_type, amount, bank_account_id, note, operator_name, performed_at)
  VALUES
    (p_id, 'chiusura_manuale', v_amount, NULL, v_note, p_operator, now());

  RETURN QUERY
    SELECT p.id, p.status::text, p.amount_paid, p.amount_remaining,
           p.payment_date, p.closed_manually, p.manual_close_reason
    FROM public.payables p WHERE p.id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_payable_manually(uuid, date, text, numeric, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8) rpc_link_riba_credit_note — usa il residuo reale, origin = 'riba'
--    (base: migration 147; stessa firma)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_link_riba_credit_note(p_credit_note_id uuid, p_target_payable_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid; v_role text; v_nc RECORD; v_tgt RECORD; v_amt numeric; v_ref text;
BEGIN
  SELECT company_id, role INTO v_company, v_role FROM public.user_profiles WHERE id = auth.uid();
  IF COALESCE(v_role,'') NOT IN ('super_advisor','contabile') THEN
    RAISE EXCEPTION 'Non autorizzato: serve il ruolo contabile o super_advisor';
  END IF;

  SELECT * INTO v_nc FROM public.payables WHERE id = p_credit_note_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota di credito non trovata o non accessibile'; END IF;
  IF NOT (v_nc.status = 'nota_credito' OR v_nc.gross_amount < 0) THEN
    RAISE EXCEPTION 'La riga selezionata non e'' una nota di credito';
  END IF;
  v_amt := public.credit_note_residual(v_nc.gross_amount, v_nc.amount_paid, v_nc.closed_manually, v_nc.payment_date);
  IF COALESCE(v_nc.closed_manually, false) OR v_amt <= 0.005 THEN
    RAISE EXCEPTION 'Nota di credito gia'' chiusa/abbinata o senza credito residuo';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payable_credit_note_links l
             WHERE l.credit_note_payable_id = p_credit_note_id AND l.status = 'pending') THEN
    RAISE EXCEPTION 'La nota di credito e'' gia'' impegnata in una distinta in attesa di riconciliazione';
  END IF;

  SELECT * INTO v_tgt FROM public.payables WHERE id = p_target_payable_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scadenza di destinazione non trovata'; END IF;

  IF v_nc.supplier_id IS DISTINCT FROM v_tgt.supplier_id
     AND COALESCE(v_nc.supplier_vat,'') IS DISTINCT FROM COALESCE(v_tgt.supplier_vat,'') THEN
    RAISE EXCEPTION 'La nota di credito e la scadenza sono di fornitori diversi';
  END IF;

  v_ref := COALESCE(v_tgt.invoice_number, '');

  INSERT INTO public.payable_credit_note_links
    (company_id, payable_id, credit_note_payable_id, amount, status, created_by, applied_at, origin)
  VALUES (v_company, p_target_payable_id, p_credit_note_id, v_amt, 'applied', auth.uid(), now(), 'riba')
  ON CONFLICT (payable_id, credit_note_payable_id)
    DO UPDATE SET status = 'applied', amount = v_amt, applied_at = now(), origin = 'riba';

  UPDATE public.payables
    SET closed_manually = true,
        payment_date = COALESCE(v_tgt.payment_date, CURRENT_DATE),
        manual_close_reason = 'Abbinata a scadenza RiBa ' || v_ref
    WHERE id = p_credit_note_id;

  INSERT INTO public.payable_actions (payable_id, action_type, amount, note, performed_at)
  VALUES (p_credit_note_id, 'abbinamento_nc_riba', v_amt,
          'Nota di credito abbinata alla scadenza RiBa ' || v_ref || ' (registrata in AVERE)', now());

  RETURN jsonb_build_object('ok', true, 'amount', v_amt, 'target', p_target_payable_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.rpc_link_riba_credit_note(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_link_riba_credit_note(uuid, uuid) TO authenticated, service_role;

COMMIT;

-- --- Verifica (sola lettura) ---------------------------------------------
-- SELECT proname, prosecdef FROM pg_proc WHERE pronamespace='public'::regnamespace
--   AND proname IN ('credit_note_residual','compensate_payable_with_credit_note','reopen_payable',
--                   'apply_credit_note_links','undo_reconcile_movement','close_payable_manually',
--                   'rpc_link_riba_credit_note') ORDER BY 1;           -- 7 righe
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='payable_credit_note_links' AND column_name='origin';  -- 1 riga
