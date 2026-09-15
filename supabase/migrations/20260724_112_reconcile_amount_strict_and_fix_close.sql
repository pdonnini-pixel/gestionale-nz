-- =====================================================================
-- Migrazione 112 — CORRETTIVA: matcher a importo STRETTO + fix chiusura 108
-- =====================================================================
-- Corregge due problemi emersi in produzione (NZ) dopo la 110/108:
--
-- PROBLEMA 1 (introdotto dalla 110): try_match_amount_bank_transaction usava una
-- tolleranza 0,3% sul LORDO e auto-agganciava sulla sola vicinanza d'importo, senza
-- conferma del fornitore. Ha prodotto falsi positivi (es. SP_54 Poli 3.057,74
-- agganciata a una disposizione da 3.051,75; fatture agganciate a commissioni di
-- fideiussione o a bonifici di altri beneficiari con importo simile/uguale).
--   -> FIX: il matcher a importo agisce SOLO quando la causale contiene il dato
--      strutturato "IMPORTO BONIFICI" (netto realmente disposto nei flussi CBI
--      aziendali), e aggancia SOLO se quel netto coincide ESATTAMENTE (<= 0,02) con
--      il lordo della fattura ed esiste un UNICO candidato. Niente piu' match per
--      percentuale, niente piu' solo-importo su causali generiche (quelle restano
--      agli altri matcher, che pretendono il fornitore in causale).
--   -> UNDO: si annullano tutti gli agganci/proposte generati dal vecchio matcher
--      (riconoscibili dalla nota "flusso CBI anonimo"): il re-run col nuovo matcher
--      ricreera' solo i 5 corretti.
--
-- PROBLEMA 2 (introdotto dalla 108): close_non_supplier_movements classificava come
-- "spesa bancaria" QUALSIASI movimento con la parola COMMISSION*. Ma i bonifici CBI
-- reali riportano in causale "IMPORTO COMMISSIONI: x,xx" -> venivano chiusi come
-- non-fornitore e sparivano dalla riconciliazione (su NZ: 182 bonifici reali chiusi
-- senza fattura). Da qui l'impossibilita' di agganciare la 322/E ecc.
--   -> FIX: la chiusura non-fornitore ESCLUDE i movimenti che riportano
--      "IMPORTO BONIFICI" (sono disposizioni di bonifico reali, non spese banca). Le
--      vere spese ("Commissioni su bonifico", "COMMISSIONI E SPESE SU FIDEIUSSIONI")
--      non hanno "IMPORTO BONIFICI" e restano correttamente chiudibili.
--   -> RIAPERTURA: si riaprono (is_reconciled=false) i bonifici reali chiusi per
--      errore dalla 108 (nota "non-fornitore" + "IMPORTO BONIFICI" + nessuna fattura
--      agganciata), cosi' tornano disponibili al motore.
--
-- Ripristina inoltre run_daily_reconciliation completo: granitico -> biettivo ->
-- importo (stretto) -> chiusura non-fornitore (corretta).
--
-- Additiva/idempotente. Reversibile (ROLLBACK a fianco: gli UNDO/riaperture non si
-- ripristinano automaticamente ma sono ri-derivabili col motore). NON distruttiva.
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago (ovunque sia stata applicata la 110).
-- Dopo l'apply, ri-eseguire il motore sullo storico:
--     SELECT public.rerun_group_reconciliation();
--     SELECT public.rerun_amount_reconciliation();
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) UNDO degli effetti del vecchio matcher a importo (nota "flusso CBI anonimo").
-- ---------------------------------------------------------------------
-- 1a) Fatture APERTE erroneamente chiuse dal matcher: riportale a non pagate
--     (il trigger update_payable_status ricalcola stato e amount_remaining).
UPDATE public.payables p
SET amount_paid = 0,
    payment_date = NULL,
    bank_transaction_id = NULL,
    status = 'da_pagare'::payable_status,
    updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM public.reconciliation_log rl
  WHERE rl.payable_id = p.id AND rl.status = 'applied'
    AND rl.notes ILIKE '%flusso CBI anonimo%'
)
AND NOT COALESCE(p.closed_manually, false);

-- 1b) Fatture CHIUSE A MANO: il matcher aveva solo valorizzato bank_transaction_id
--     (nessuna doppia scrittura). Basta scollegare il movimento.
UPDATE public.payables p
SET bank_transaction_id = NULL, updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM public.reconciliation_log rl
  WHERE rl.payable_id = p.id AND rl.status = 'applied'
    AND rl.notes ILIKE '%flusso CBI anonimo%'
)
AND COALESCE(p.closed_manually, false);

-- 1c) Movimenti riaperti (il matcher li aveva marcati riconciliati).
UPDATE public.bank_transactions bt
SET is_reconciled = false, reconciled_at = NULL, reconciled_invoice_id = NULL
WHERE EXISTS (
  SELECT 1 FROM public.reconciliation_log rl
  WHERE rl.bank_transaction_id = bt.id AND rl.status = 'applied'
    AND rl.notes ILIKE '%flusso CBI anonimo%'
);

-- 1d) Rimuove le righe di log (agganci + proposte) del vecchio matcher.
DELETE FROM public.reconciliation_log WHERE notes ILIKE '%flusso CBI anonimo%';

-- ---------------------------------------------------------------------
-- 2) Matcher a importo STRETTO: solo su "IMPORTO BONIFICI", netto esatto, unico.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_match_amount_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bt RECORD;
  v_descr TEXT;
  v_net NUMERIC := NULL;   -- netto realmente disposto, da "IMPORTO BONIFICI"
  v_cand RECORD;
  v_n INT := 0;
  v_only RECORD;
  m TEXT;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing');
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;

  v_descr := coalesce(v_bt.description, '');

  -- REQUISITO: netto strutturato "IMPORTO BONIFICI" in causale. Senza di esso il
  -- movimento NON e' un flusso CBI anonimo -> lasciato agli altri matcher.
  m := (regexp_match(v_descr, 'IMPORTO\s+BONIFICI\s*:?\s*([0-9][0-9.]*,[0-9]{2})', 'i'))[1];
  IF m IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'no_structured_net');
  END IF;
  v_net := replace(replace(m, '.', ''), ',', '.')::numeric;

  -- Candidati: fatture non agganciate (aperte o chiuse a mano) con lordo == netto
  -- ESATTO (<= 0,02), in finestra temporale coerente. Nessun match per percentuale.
  FOR v_cand IN
    SELECT p.*
    FROM public.payables p
    WHERE p.company_id = v_bt.company_id
      AND p.bank_transaction_id IS NULL
      AND p.gross_amount > 0
      AND COALESCE(p.is_placeholder, false) = false
      AND ( p.status IN ('da_pagare', 'in_scadenza', 'scaduto')
            OR (p.status = 'pagato' AND COALESCE(p.closed_manually, false)) )
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = p.id AND l.status = 'pending')
      AND abs(p.gross_amount - v_net) <= 0.02
      AND v_bt.transaction_date
            BETWEEN COALESCE(p.invoice_date, p.due_date, v_bt.transaction_date) - INTERVAL '120 days'
                AND COALESCE(p.due_date, p.invoice_date, v_bt.transaction_date) + INTERVAL '30 days'
  LOOP
    v_n := v_n + 1;
    v_only := v_cand;
  END LOOP;

  IF v_n = 0 THEN
    RETURN jsonb_build_object('matched', false);
  END IF;

  -- Candidato UNICO -> aggancio (chiusa a mano: solo aggancio; aperta: applica).
  IF v_n = 1 THEN
    IF v_only.status = 'pagato' AND COALESCE(v_only.closed_manually, false) THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_only.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 95, 'applied', v_only.gross_amount,
              'auto: IMPORTO BONIFICI netto esatto e univoco (flusso CBI anonimo) — chiusa a mano, solo aggancio');
    ELSE
      UPDATE public.payables
      SET amount_paid = v_only.gross_amount,
          amount_remaining = 0,
          status = 'pagato'::payable_status,
          payment_date = v_bt.transaction_date,
          bank_transaction_id = p_bt_id,
          updated_at = now()
      WHERE id = v_only.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 90, 'applied', v_only.gross_amount,
              'auto: IMPORTO BONIFICI netto esatto e univoco (flusso CBI anonimo)');
    END IF;

    UPDATE public.bank_transactions
    SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_only.id
    WHERE id = p_bt_id;

    RETURN jsonb_build_object('matched', true, 'auto', true, 'payable_id', v_only.id, 'net', v_net);
  END IF;

  -- Piu' candidati con lo stesso netto esatto: propone, non chiude al buio.
  INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
  SELECT v_bt.company_id, p_bt_id, p.id, 'auto_fuzzy', 60, 'to_confirm', p.gross_amount,
         'proposta: IMPORTO BONIFICI netto esatto (flusso CBI anonimo) — piu'' candidati, conferma manuale'
  FROM public.payables p
  WHERE p.company_id = v_bt.company_id
    AND p.bank_transaction_id IS NULL
    AND p.gross_amount > 0
    AND COALESCE(p.is_placeholder, false) = false
    AND ( p.status IN ('da_pagare', 'in_scadenza', 'scaduto')
          OR (p.status = 'pagato' AND COALESCE(p.closed_manually, false)) )
    AND abs(p.gross_amount - v_net) <= 0.02
    AND v_bt.transaction_date
          BETWEEN COALESCE(p.invoice_date, p.due_date, v_bt.transaction_date) - INTERVAL '120 days'
              AND COALESCE(p.due_date, p.invoice_date, v_bt.transaction_date) + INTERVAL '30 days';

  RETURN jsonb_build_object('matched', false, 'proposed', v_n, 'reason', 'ambiguous_proposed');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.try_match_amount_bank_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_match_amount_bank_transaction(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3) Fix chiusura non-fornitore: NON chiudere i bonifici reali (IMPORTO BONIFICI).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_non_supplier_movements()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n INT;
BEGIN
  WITH cand AS (
    SELECT bt.id, upper(coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '')) AS d
    FROM public.bank_transactions bt
    WHERE bt.amount < 0 AND COALESCE(bt.is_reconciled, false) = false AND bt.status IN ('posted', 'booked')
  ),
  match AS (
    SELECT id, d,
      CASE
        WHEN d ~ '(EMOLUMENTI|STIPEND|\ySALARI|RETRIBUZ|BUSTA PAGA)' THEN 'stipendi'
        WHEN d ~ '(\yF24\y|DELEGA UNIFICATA|\yDELEGHE\y|IMPOSTE E TASSE|IMPOSTE/TASSE|\yIRPEF\y|\yINPS\y|\yIRAP\y|RITENUT|\yTRIBUT|DIRITTO CAMERALE|\yTARI\y|CBILL|PAGOPA)' THEN 'tasse'
        WHEN d ~ '(PAG\.?POS|\yCARTA\y|MASTERCARD|\yVISA\y|\yBANCOMAT\y|PRELIEV)' THEN 'carte'
        WHEN d ~ '(GIROCONTO|GIROFONDI|\yTRASFERIMENTO\y)' THEN 'giroconti'
        WHEN d ~ '(COMMISSION|\yONERI\y|COMPETENZE|\yBOLLO\y|INTERESS|PAGOBANCOMAT)' THEN 'spese_banca'
        ELSE NULL
      END AS categoria
    FROM cand
    -- ESCLUSIONI: bonifici a fornitore, RiBa, finanziamenti, assegni, e — NUOVO —
    -- i flussi CBI con "IMPORTO BONIFICI" (disposizioni di bonifico reali: la parola
    -- COMMISSIONI nella causale non deve farli scambiare per spese bancarie).
    WHERE d !~ '(A FAVORE|EFFETTI RITIRAT|RIMBORSO FINANZIAMENT|\yMUTU|PRESTIT|\yASSEGNO|IMPORTO BONIFICI)'
  ),
  upd AS (
    UPDATE public.bank_transactions bt
    SET is_reconciled = true, reconciled_at = now(), category = m.categoria,
        note = COALESCE(bt.note || ' | ', '') || 'chiuso automaticamente (non-fornitore: ' || m.categoria || ')'
    FROM match m
    WHERE m.id = bt.id AND m.categoria IS NOT NULL
    RETURNING bt.id
  )
  SELECT count(*) INTO v_n FROM upd;
  RETURN jsonb_build_object('chiusi', v_n);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.close_non_supplier_movements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_non_supplier_movements() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4) Riapre i bonifici reali chiusi per errore dalla 108 (COMMISSIONI -> spese_banca).
-- ---------------------------------------------------------------------
UPDATE public.bank_transactions bt
SET is_reconciled = false, reconciled_at = NULL,
    note = COALESCE(bt.note, '') || ' | riaperto (bonifico reale chiuso per errore come spesa banca)'
WHERE bt.amount < 0
  AND COALESCE(bt.is_reconciled, false) = true
  AND bt.reconciled_invoice_id IS NULL
  AND upper(coalesce(bt.description, '')) ~ 'IMPORTO BONIFICI'
  AND coalesce(bt.note, '') ILIKE '%non-fornitore%';

-- ---------------------------------------------------------------------
-- 5) run_daily_reconciliation completo: granitico -> biettivo -> importo -> chiusura.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_group jsonb;
  v_bij jsonb;
  v_amt jsonb;
  v_close jsonb;
BEGIN
  v_group := public.rerun_group_reconciliation();
  v_bij := public.rerun_bijective_reconciliation();
  v_amt := public.rerun_amount_reconciliation();
  v_close := public.close_non_supplier_movements();
  RETURN jsonb_build_object('granitici', v_group, 'biettivo', v_bij, 'importo_anonimo', v_amt,
                            'chiusi_non_fornitore', v_close, 'run_at', now());
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.run_daily_reconciliation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_daily_reconciliation() TO service_role;
