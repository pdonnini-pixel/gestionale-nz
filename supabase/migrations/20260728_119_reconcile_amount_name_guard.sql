-- =====================================================================
-- Migrazione 119 — Matcher a-importo (flussi CBI): guard sul nome beneficiario
-- =====================================================================
-- REGOLA R5/R6 (Patrizio): il fornitore va confermato dal NOME, mai per solo
-- importo; 1 bonifico = 1 fornitore. Allineamento backend del fix frontend #382/#383
-- (lettura del beneficiario "*NOME" nei bonifici internet-banking).
--
-- CONTESTO (verificato sul DB vivo NZ, 2026-07-28):
--   • try_match_amount_bank_transaction aggancia per solo IMPORTO (causale "anonima"
--     con "IMPORTO BONIFICI"), auto se il candidato per importo è UNICO. Non guarda
--     il nome. Su NZ: 410 movimenti con "IMPORTO BONIFICI", di cui 208 realmente
--     anonimi ("A FAVORE DI N.D." + boilerplate CBI) e **19 con un beneficiario VERO**
--     in causale ("A FAVORE DI: <nome>"). Su quei 19, se per caso una fattura di un
--     ALTRO fornitore avesse lo stesso netto, il match scatterebbe ignorando il nome
--     — esattamente la collisione che ha originato il fix (Sforazzini→Amazon lato UI).
--   • Il caso "*SFORAZZINI SRL SF-… " NON passa da qui (non ha "IMPORTO BONIFICI"):
--     quello lo chiude il fix frontend. Questa migration copre il buco LATENTE dei
--     flussi CBI che portano SIA il netto strutturato SIA un nome.
--
-- FIX: la funzione, quando la causale contiene un beneficiario NOMINATO (nome con
-- una parola distintiva ≥4 lettere, non generica e non boilerplate CBI), considera
-- SOLO i candidati il cui fornitore è confermato in causale (supplier_confirmed_in_text).
-- Sui flussi realmente anonimi ("A FAVORE DI N.D.", "DISPOSIZIONE FILIALE DISPONENTE",
-- nessun nome) il comportamento resta identico a oggi.
--
-- ZERO REGRESSIONI verificate PRIMA dell'apply su NZ+Made+Zago: nessuno degli
-- auto-match già applicati da questa funzione verrebbe bloccato dal guard
-- (i 5 casi "A FAVORE DI N.D." restano anonimi → non nominati).
--
-- Additiva/idempotente (CREATE OR REPLACE). NON distruttiva: è SOLO più conservativa
-- (al più propone invece di auto-chiudere; mai crea un match nuovo). Reversibile con
-- il file _ROLLBACK. ⚠️ REGOLA #0 — NZ + Made + Zago.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Helper: la causale nomina un beneficiario "vero"?
--    Estrae la finestra dopo "a favore di[:]" oppure dopo "*", e verifica che
--    contenga un token ≥4 lettere, distintivo (non generico societario) e NON
--    boilerplate CBI ("disposizione/filiale/disponente/…"). Così "A FAVORE DI N.D.
--    DISPOSIZIONE FILIALE DISPONENTE 2430" NON è considerato nominato.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.causale_has_named_beneficiary(p_text text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM regexp_split_to_table(
      lower(COALESCE(
        substring(COALESCE(p_text,'') from '(?i)a\s+favore\s+di\s*:?\s*(.{0,45})'),
        substring(COALESCE(p_text,'') from '\*\s*([A-Za-z].{0,44})'),
        '')),
      '[^a-z0-9]+') w
    WHERE length(w) >= 4
      AND w ~ '[a-z]'                                   -- almeno una lettera (esclude "2430")
      AND w <> ALL (ARRAY[
        -- suffissi societari / parole generiche (come supplier_confirmed_in_text)
        'srl','srls','spa','snc','sas','sapa','scarl','scrl','propco','group','gruppo',
        'holding','italia','italy','italiana','societa','coop','cooperativa','unipersonale',
        'socio','unico','associati','associato','servizi','service','services',
        -- boilerplate CBI / home banking (NON sono nomi di fornitore)
        'disposizione','filiale','disponente','favore','bonifici','bonifico','commissioni',
        'flusso','pagamenti','pagamento','importo','vostra','nostra','internet','banking',
        'tramite','disposto','causale','numero','aggiuntive','info','note','banca','beneficiario'
      ])
  );
$function$;
REVOKE EXECUTE ON FUNCTION public.causale_has_named_beneficiary(text) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------
-- 2) try_match_amount_bank_transaction: guard sul nome nei candidati.
--    (identica alla versione 112 + la sola condizione di conferma nome nei due
--     rami candidati — conteggio e proposta).
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
  v_named BOOLEAN := false; -- la causale nomina un beneficiario vero?
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

  -- R5/R6: se la causale nomina un beneficiario vero, i candidati per importo devono
  -- avere il fornitore confermato in causale (niente aggancio al buio a un altro nome).
  v_named := public.causale_has_named_beneficiary(v_descr);

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
      AND ( NOT v_named
            OR public.supplier_confirmed_in_text(p.supplier_name, p.supplier_vat, v_descr) )
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
    AND ( NOT v_named
          OR public.supplier_confirmed_in_text(p.supplier_name, p.supplier_vat, v_descr) )
    AND v_bt.transaction_date
          BETWEEN COALESCE(p.invoice_date, p.due_date, v_bt.transaction_date) - INTERVAL '120 days'
              AND COALESCE(p.due_date, p.invoice_date, v_bt.transaction_date) + INTERVAL '30 days';

  RETURN jsonb_build_object('matched', false, 'proposed', v_n, 'reason', 'ambiguous_proposed');
END;
$function$;
