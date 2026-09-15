-- =============================================================================
-- Motore di riconciliazione v3 — gerarchia di chiavi, dalla piu' certa alla piu' debole
-- =============================================================================
--
-- CONTESTO (analisi 03/09/2026 sui dati vivi NZ)
-- Su 8 pagamenti realmente eseguiti il 07/08 e il 20/08, nessuno era stato agganciato
-- al proprio movimento bancario. Le cause, tutte verificate una per una:
--
--   1. FINESTRA DATE TROPPO STRETTA. try_match_amount_bank_transaction accettava un
--      movimento solo fino a due_date + 30 giorni. La fattura DWS 26VAL-0526 scadeva
--      il 13/04 ed e' stata pagata il 07/08: fuori finestra, quindi mai proposta,
--      benche' la causale esponesse "IMPORTO BONIFICI: 35.785,87" esatto al centesimo.
--
--   2. NUMERO FATTURA NON NORMALIZZATO. invoice_number_keys('2046/01') restituiva solo
--      '204601', mai '2046'. La causale diceva "GGZ SF-2046". Nessun aggancio.
--      Stesso problema su '8/1660' (TANESINI), '88-2026' (NIGRO), '882/26' (SHINE).
--
--   3. SPESE BANCARIE. Sui flussi CBI la banca addebita fattura + commissioni
--      (35.785,87 + 1,75 = 35.787,62). Il confronto a importo esatto falliva.
--
--   4. LA DISTINTA NON VENIVA USATA. Quando una scadenza sta in una distinta di
--      pagamento sappiamo banca e data della disposizione: e' l'informazione piu'
--      forte che abbiamo, ed era completamente ignorata dal motore.
--
--   5. RISCHIO OPPOSTO: SOLO IMPORTO POTEVA CHIUDERE DA SOLO. Nel punteggio,
--      importo esatto (50) + data esatta (20) + banca attesa (10) = 80 = soglia di
--      auto_exact, senza che il fornitore o il numero fattura fossero mai confermati.
--      E' esattamente lo scramble gia' documentato su SPM Investigazioni in
--      PAYMENT_PLAN_NOTES.md: su fornitori con fatture tutte dello stesso importo il
--      motore chiude a catena la fattura sbagliata.
--
-- COSA FA QUESTA MIGRATION
--   A. invoice_number_keys: aggiunge i segmenti numerici separati, esclude gli anni.
--   B. bank_movement_net: legge "IMPORTO BONIFICI" dalla causale dei flussi CBI.
--   C. payable_in_distinta_for_movement: la scadenza e' in distinta su quella banca
--      e in quella finestra di date.
--   D. try_match_distinta_bank_transaction: nuovo livello 0, il piu' affidabile.
--   E. try_match_bank_transaction v3: tolleranza spese asimmetrica, chiavi fattura,
--      bonus distinta e — soprattutto — GATE DI IDENTITA': niente auto_exact senza
--      fornitore, numero fattura o distinta a confermare di chi si tratta.
--   F. try_match_amount_bank_transaction v3: finestra a 180 giorni, disambiguazione
--      per distinta.
--   G. trigger e cron: il livello distinta entra come primo passo.
--
-- SICUREZZA: nessun dato cancellato, nessuna colonna rimossa. Solo CREATE OR REPLACE
-- di funzioni. Rollback disponibile in _ROLLBACK.sql (ripristina la v2).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A. Chiavi del numero fattura: i segmenti contano
-- -----------------------------------------------------------------------------
-- Prima: '2046/01' -> {204601}.  Ora: '2046/01' -> {204601, 2046, 1, 01}.
-- Gli anni a se' stanti ('2026' dentro '88-2026') sono rumore e vengono esclusi,
-- salvo quando l'anno E' l'intero numero fattura.
-- La sicurezza resta a carico di chi chiama, tramite la lunghezza minima della
-- chiave: vedi p_min_len in invoice_cited_in_text e le soglie in try_match_*.
CREATE OR REPLACE FUNCTION public.invoice_number_keys(p_inv text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
  WITH toks AS (
    -- tutte le cifre attaccate (comportamento storico)
    SELECT regexp_replace(coalesce(p_inv, ''), '[^0-9]', '', 'g') AS k
    UNION ALL
    -- sequenze lunghe interne (comportamento storico)
    SELECT m[1] FROM regexp_matches(coalesce(p_inv, ''), '([0-9]{6,})', 'g') m
    UNION ALL
    -- NOVITA' v3: ogni segmento numerico separato
    SELECT m[1] FROM regexp_matches(coalesce(p_inv, ''), '([0-9]+)', 'g') m
  ),
  norm AS (
    SELECT k FROM toks WHERE k <> ''
    UNION ALL
    SELECT ltrim(k, '0') FROM toks WHERE ltrim(k, '0') <> ''
  )
  SELECT ARRAY(
    SELECT DISTINCT v FROM norm x(v)
    WHERE NOT (
      -- Un anno da solo non identifica una fattura: '2026' dentro '88-2026' e' rumore.
      -- L'intervallo e' stretto apposta (1990-2035): numeri come 2046 o 2540 sono
      -- numeri di fattura veri e devono restare chiavi valide.
      length(v) = 4
      AND v ~ '^[0-9]{4}$'
      AND v::int BETWEEN 1990 AND 2035
      AND regexp_replace(coalesce(p_inv, ''), '[^0-9]', '', 'g') <> v
    )
  );
$function$;

COMMENT ON FUNCTION public.invoice_number_keys(text) IS
  'Chiavi normalizzate di un numero fattura per il confronto con la causale bancaria. v3: include i segmenti numerici separati (2046/01 -> 2046) ed esclude gli anni isolati. La lunghezza minima della chiave la decide il chiamante.';

-- -----------------------------------------------------------------------------
-- B. Importo netto dei bonifici dentro un flusso CBI
-- -----------------------------------------------------------------------------
-- Le disposizioni MPS espongono in causale:
--   "NUM. TOT. PAGAMENTI: 1 IMPORTO BONIFICI: 35.785,87 IMPORTO COMMISSIONI: 1,75"
-- L'importo utile per il confronto con la fattura e' quello dei bonifici, non il
-- totale addebitato.
CREATE OR REPLACE FUNCTION public.bank_movement_net(p_descr text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
  SELECT NULLIF(
    replace(replace(
      (regexp_match(coalesce(p_descr, ''), 'IMPORTO\s+BONIFICI\s*:?\s*([0-9][0-9.]*,[0-9]{2})', 'i'))[1],
      '.', ''), ',', '.'),
    '')::numeric;
$function$;

COMMENT ON FUNCTION public.bank_movement_net(text) IS
  'Estrae "IMPORTO BONIFICI" dalla causale di un flusso CBI: e'' la quota che paga le fatture, al netto delle commissioni bancarie. NULL se la causale non lo espone.';

-- -----------------------------------------------------------------------------
-- C. La scadenza e' in una distinta compatibile con questo movimento?
-- -----------------------------------------------------------------------------
-- Una distinta e' un'istruzione di pagamento data da una persona: dice quale banca
-- e quando. E' la conferma di identita' piu' forte disponibile, piu' della causale.
-- Finestra: da 3 giorni prima della disposizione (valuta anticipata) a 20 giorni dopo
-- (la banca esegue, poi contabilizza).
CREATE OR REPLACE FUNCTION public.payable_in_distinta_for_movement(
  p_payable_id uuid, p_bank_account_id uuid, p_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.payable_actions a
    WHERE a.payable_id = p_payable_id
      AND a.action_type = 'disposizione'
      AND (
        p_bank_account_id IS NULL
        OR a.bank_account_id IS NULL
        OR a.bank_account_id = p_bank_account_id
      )
      AND p_date BETWEEN (a.performed_at::date - 3) AND (a.performed_at::date + 20)
  );
$function$;

COMMENT ON FUNCTION public.payable_in_distinta_for_movement(uuid, uuid, date) IS
  'True se la scadenza e'' stata disposta in una distinta sulla stessa banca del movimento e in una finestra di date compatibile (-3 / +20 giorni).';

-- -----------------------------------------------------------------------------
-- D. LIVELLO 0 — match guidato dalla distinta
-- -----------------------------------------------------------------------------
-- Il piu' affidabile di tutti: sappiamo gia' che quella fattura andava pagata da
-- quella banca in quei giorni. Resta il confronto sull'importo, con tre letture
-- ammesse: importo esatto, importo netto del flusso CBI, importo piu' spese bancarie.
-- Applica SOLO se il candidato e' unico. Altrimenti propone e aspetta una persona.
CREATE OR REPLACE FUNCTION public.try_match_distinta_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD;
  v_mov NUMERIC;
  v_net NUMERIC;
  v_n INT := 0;
  v_ids uuid[];
  v_only RECORD;
  v_applied NUMERIC;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing');
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;

  v_mov := abs(v_bt.amount);
  v_net := public.bank_movement_net(v_bt.description);

  SELECT count(*), array_agg(p.id) INTO v_n, v_ids
  FROM public.payables p
  WHERE p.company_id = v_bt.company_id
    AND p.bank_transaction_id IS NULL
    AND p.gross_amount > 0
    AND COALESCE(p.is_placeholder, false) = false
    AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto', 'parziale', 'pagato')
    AND public.payable_in_distinta_for_movement(p.id, v_bt.bank_account_id, v_bt.transaction_date)
    AND (
      -- importo esatto
      abs(p.gross_amount - v_mov) <= 0.02
      -- quota bonifici del flusso CBI (il resto sono commissioni)
      OR (v_net IS NOT NULL AND abs(p.gross_amount - v_net) <= 0.02)
      -- movimento maggiore della fattura per spese bancarie: tolleranza ASIMMETRICA
      OR (v_mov > p.gross_amount
          AND (v_mov - p.gross_amount) <= LEAST(5.00, GREATEST(0.50, p.gross_amount * 0.002)))
      -- acconto: l'importo disposto in distinta coincide col movimento
      OR EXISTS (
        SELECT 1 FROM public.payable_actions a
        WHERE a.payable_id = p.id AND a.action_type = 'disposizione'
          AND a.amount IS NOT NULL AND abs(a.amount - v_mov) <= 0.02
      )
    );

  IF v_n <> 1 THEN
    -- Zero candidati: passa al livello successivo. Piu' d'uno: mai indovinare,
    -- si propone e decide una persona.
    IF v_n > 1 THEN
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      SELECT v_bt.company_id, p_bt_id, p.id, 'auto_fuzzy', 70, 'to_confirm', p.gross_amount,
             'proposta (distinta): piu'' scadenze disposte su questa banca in queste date con importo compatibile'
      FROM public.payables p WHERE p.id = ANY(v_ids);
    END IF;
    RETURN jsonb_build_object('matched', false, 'reason',
      CASE WHEN v_n = 0 THEN 'no_candidate_in_distinta' ELSE 'ambiguous_in_distinta' END,
      'proposed', COALESCE(v_n, 0));
  END IF;

  SELECT * INTO v_only FROM public.payables WHERE id = v_ids[1];

  -- Fattura gia' chiusa (a mano o all'import) oppure gia' pagata in parte: SOLO aggancio.
  -- Nessuna riscrittura di importi, altrimenti si paga due volte.
  IF v_only.status IN ('pagato', 'parziale') THEN
    UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_only.id;
    UPDATE public.bank_transactions
      SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_only.id
      WHERE id = p_bt_id;
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id,
      match_type, confidence, status, applied_amount, notes)
    VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 95, 'applied', 0,
      'auto (distinta): scadenza disposta su questa banca in queste date — gia'' pagata, solo aggancio');
    RETURN jsonb_build_object('matched', true, 'auto', true, 'linked_only', true, 'payable_id', v_only.id);
  END IF;

  v_applied := LEAST(v_mov, COALESCE(v_only.amount_remaining,
                                     v_only.gross_amount - COALESCE(v_only.amount_paid, 0),
                                     v_only.gross_amount));

  UPDATE public.payables
  SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
      payment_date = v_bt.transaction_date,
      bank_transaction_id = p_bt_id,
      updated_at = now()
  WHERE id = v_only.id;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_only.id
  WHERE id = p_bt_id;

  INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id,
    match_type, confidence, status, applied_amount, notes)
  VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 95, 'applied', v_applied,
    'auto (distinta): scadenza disposta su questa banca in queste date, importo compatibile');

  -- 'applied_amount' e non 'applied': in try_match_bank_transaction 'applied' e' un
  -- booleano, e due chiavi con lo stesso nome e tipo diverso sono una trappola.
  RETURN jsonb_build_object('matched', true, 'auto', true, 'payable_id', v_only.id, 'applied_amount', v_applied);
END;
$function$;

COMMENT ON FUNCTION public.try_match_distinta_bank_transaction(uuid) IS
  'Livello 0 del motore: aggancia un movimento alla scadenza che una persona ha disposto in distinta su quella banca in quei giorni. Applica solo se il candidato e'' unico.';

-- -----------------------------------------------------------------------------
-- E. try_match_bank_transaction v3
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_match_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
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
  v_best_identity BOOLEAN := false;
  v_pay_is_closed BOOLEAN;
  v_score_amount NUMERIC;
  v_score_name NUMERIC;
  v_score_date NUMERIC;
  v_score_invoice NUMERIC;
  v_score_disp NUMERIC;
  v_score_total NUMERIC;
  v_bank_bonus NUMERIC;
  v_amount_diff_pct NUMERIC;
  v_days_diff INTEGER;
  v_match_type TEXT;
  v_log_status TEXT;
  v_descr TEXT;
  v_name_in_descr BOOLEAN;
  v_inv_hit BOOLEAN;
  v_disp_hit BOOLEAN;
  v_identity BOOLEAN;
  v_mov NUMERIC;
  v_net NUMERIC;
  v_cmp NUMERIC;
  v_key_len INTEGER;
  v_ties INTEGER := 0;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'amount_not_negative_or_tx_not_found');
  END IF;

  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_reconciled');
  END IF;

  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' ' || coalesce(v_bt.merchant_name, ''));
  v_mov := abs(v_bt.amount);
  v_net := public.bank_movement_net(v_bt.description);

  FOR v_pay IN
    SELECT *,
           (status = 'pagato') AS is_closed_manual
    FROM public.payables
    WHERE company_id = v_bt.company_id
      AND bank_transaction_id IS NULL
      AND gross_amount > 0
      AND status IN ('da_pagare', 'in_scadenza', 'scaduto', 'pagato')
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = payables.id AND l.status = 'pending'
      )
  LOOP
    v_pay_is_closed := COALESCE(v_pay.is_closed_manual, false);

    -- Importo da confrontare. Tre letture, in ordine di precisione:
    --  1) la quota bonifici del flusso CBI, quando la causale la espone;
    --  2) il movimento al netto delle spese bancarie (tolleranza ASIMMETRICA: la
    --     banca puo' addebitare piu' della fattura, mai meno);
    --  3) il movimento cosi' com'e'.
    v_cmp := v_mov;
    IF v_net IS NOT NULL AND abs(v_net - v_pay.gross_amount) <= 0.02 THEN
      v_cmp := v_pay.gross_amount;
    ELSIF v_mov > v_pay.gross_amount
          AND (v_mov - v_pay.gross_amount) <= LEAST(5.00, GREATEST(0.50, v_pay.gross_amount * 0.002)) THEN
      v_cmp := v_pay.gross_amount;
    END IF;

    v_amount_diff_pct := abs(v_cmp - v_pay.gross_amount) / v_pay.gross_amount * 100;
    v_score_amount := GREATEST(0, 50 - v_amount_diff_pct * 5);

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

    -- La distinta come conferma di identita': una persona ha detto che questa
    -- scadenza andava pagata da questa banca in questi giorni.
    v_disp_hit := public.payable_in_distinta_for_movement(v_pay.id, v_bt.bank_account_id, v_bt.transaction_date);
    v_score_disp := CASE WHEN v_disp_hit THEN 25 ELSE 0 END;

    -- Numero fattura: chiavi normalizzate v3. La soglia di lunghezza tiene fuori i
    -- falsi positivi: due o tre cifre isolate compaiono ovunque in una causale.
    v_score_invoice := 0;
    v_inv_hit := false;
    SELECT max(length(k)) INTO v_key_len
    FROM unnest(public.invoice_number_keys(v_pay.invoice_number)) k
    WHERE length(k) >= 2
      AND v_descr ~ ('(^|[^0-9])' || k || '([^0-9]|$)');

    IF v_key_len IS NOT NULL THEN
      IF v_key_len >= 5 THEN
        v_inv_hit := true;
        v_score_invoice := CASE WHEN v_amount_diff_pct <= 2 THEN 45 ELSE 15 END;
      ELSIF v_key_len >= 3 AND v_amount_diff_pct <= 2 AND (v_name_in_descr OR v_disp_hit) THEN
        v_inv_hit := true;
        v_score_invoice := 45;
      ELSIF v_amount_diff_pct <= 2 AND v_name_in_descr THEN
        v_inv_hit := true;
        v_score_invoice := 45;
      END IF;
    END IF;

    v_identity := v_name_in_descr OR v_inv_hit OR v_disp_hit;

    -- Gate per le fatture GIA' PAGATE: mai solo-importo, e scarto entro il 5%.
    IF v_pay_is_closed AND (NOT v_identity OR v_amount_diff_pct > 5) THEN
      CONTINUE;
    END IF;

    v_score_total := LEAST(100, v_score_amount + v_score_name + v_score_date + v_bank_bonus + v_score_invoice + v_score_disp);

    IF v_score_total > v_best_score THEN
      v_best_score := v_score_total;
      v_best_payable_id := v_pay.id;
      v_best_amount := v_score_amount;
      v_best_name := v_score_name;
      v_best_date := v_score_date;
      v_best_is_closed := v_pay_is_closed;
      v_best_identity := v_identity;
      v_ties := 1;
    ELSIF v_score_total = v_best_score AND v_score_total > 0 THEN
      -- Pari merito: due scadenze indistinguibili per il motore. Vedi sotto.
      v_ties := v_ties + 1;
    END IF;
  END LOOP;

  IF v_best_payable_id IS NULL OR v_best_score < 50 THEN
    RETURN jsonb_build_object('matched', false, 'best_score', v_best_score);
  END IF;

  -- GATE DI IDENTITA' (novita' v3, la piu' importante).
  -- Un punteggio alto costruito solo su importo, data e banca non basta a chiudere
  -- niente: su un fornitore con fatture tutte uguali aggancia la fattura sbagliata e
  -- lo scramble si propaga a catena (caso SPM Investigazioni, PAYMENT_PLAN_NOTES.md).
  -- Serve sempre almeno una conferma di CHI e' il beneficiario: fornitore in causale,
  -- numero fattura, oppure la distinta. Senza, si propone e decide una persona.
  --
  -- Seconda guardia: PARI MERITO. Se due scadenze arrivano allo stesso punteggio
  -- massimo il motore non ha modo di distinguerle, e sceglierne una e' tirare a
  -- indovinare su un dato contabile. Si propone e basta.
  IF v_best_score >= 80 AND NOT v_best_is_closed AND v_best_identity AND v_ties = 1 THEN
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
    CASE
      WHEN v_best_is_closed THEN 'auto-generated: fattura gia'' pagata — conferma aggancio movimento'
      WHEN NOT v_best_identity THEN 'auto-generated: solo importo/data/banca, beneficiario non confermato — serve conferma'
      WHEN v_ties > 1 THEN 'auto-generated: ' || v_ties || ' scadenze a pari punteggio, il motore non puo'' scegliere — serve conferma'
      ELSE 'auto-generated by try_match_bank_transaction v3'
    END
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
    'identity', v_best_identity,
    'applied', v_match_type = 'auto_exact'
  );
END;
$function$;

-- -----------------------------------------------------------------------------
-- F. try_match_amount_bank_transaction v3 — flussi CBI anonimi
-- -----------------------------------------------------------------------------
-- Due correzioni:
--  * finestra date da +30 a +180 giorni dopo la scadenza. I pagamenti in ritardo
--    sono la norma, non l'eccezione: DWS 26VAL-0526 scaduta il 13/04 e pagata il
--    07/08 restava invisibile al motore.
--  * quando i candidati sono piu' d'uno, la distinta disambigua: se uno solo dei
--    candidati era stato disposto su quella banca in quei giorni, e' quello.
CREATE OR REPLACE FUNCTION public.try_match_amount_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD;
  v_descr TEXT;
  v_net NUMERIC := NULL;
  v_named BOOLEAN := false;
  v_n INT := 0;
  v_n_disp INT := 0;
  v_ids uuid[];
  v_disp_id uuid;
  v_only RECORD;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing');
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;

  v_descr := coalesce(v_bt.description, '');
  v_net := public.bank_movement_net(v_descr);
  IF v_net IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'no_structured_net');
  END IF;

  v_named := public.causale_has_named_beneficiary(v_descr);

  WITH cand AS (
    SELECT p.id,
           public.payable_in_distinta_for_movement(p.id, v_bt.bank_account_id, v_bt.transaction_date) AS in_disp
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
                AND COALESCE(p.due_date, p.invoice_date, v_bt.transaction_date) + INTERVAL '180 days'
  )
  SELECT count(*), count(*) FILTER (WHERE in_disp),
         array_agg(id), (array_agg(id) FILTER (WHERE in_disp))[1]
    INTO v_n, v_n_disp, v_ids, v_disp_id
  FROM cand;

  IF v_n = 0 THEN
    RETURN jsonb_build_object('matched', false);
  END IF;

  -- Piu' candidati a pari importo: la distinta decide, se ne indica uno solo.
  IF v_n = 1 THEN
    SELECT * INTO v_only FROM public.payables WHERE id = v_ids[1];
  ELSIF v_n_disp = 1 THEN
    SELECT * INTO v_only FROM public.payables WHERE id = v_disp_id;
  ELSE
    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
    SELECT v_bt.company_id, p_bt_id, p.id, 'auto_fuzzy', 60, 'to_confirm', p.gross_amount,
           'proposta: IMPORTO BONIFICI netto esatto (flusso CBI anonimo) — piu'' candidati, conferma manuale'
    FROM public.payables p WHERE p.id = ANY(v_ids);
    RETURN jsonb_build_object('matched', false, 'proposed', v_n, 'reason', 'ambiguous_proposed');
  END IF;

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

  RETURN jsonb_build_object('matched', true, 'auto', true, 'payable_id', v_only.id, 'net', v_net,
                            'disambiguated_by_distinta', (v_n > 1));
END;
$function$;

-- -----------------------------------------------------------------------------
-- G. Trigger e cron: la distinta entra come primo passo
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_auto_reconcile_bank_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE v_res jsonb;
BEGIN
  IF NEW.status IN ('posted', 'booked') AND NEW.amount < 0 THEN
    -- Livello 0: la distinta, che e' un'istruzione esplicita di una persona.
    v_res := public.try_match_distinta_bank_transaction(NEW.id);
    IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
      v_res := public.try_match_group_bank_transaction(NEW.id);
      IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
        v_res := public.try_match_group_numbers_bank_transaction(NEW.id);
        IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
          v_res := public.try_match_bank_transaction(NEW.id);
          IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
            PERFORM public.try_match_amount_bank_transaction(NEW.id);
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Ripassata notturna sul livello distinta, per i movimenti arrivati prima della
-- disposizione o rimasti indietro.
CREATE OR REPLACE FUNCTION public.rerun_distinta_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD;
  v_res jsonb;
  v_matched INT := 0;
  v_seen INT := 0;
BEGIN
  FOR v_bt IN
    SELECT id FROM public.bank_transactions
    WHERE amount < 0
      AND COALESCE(is_reconciled, false) = false
      AND status IN ('posted', 'booked')
      AND transaction_date >= (CURRENT_DATE - INTERVAL '400 days')
    ORDER BY transaction_date DESC
  LOOP
    v_seen := v_seen + 1;
    v_res := public.try_match_distinta_bank_transaction(v_bt.id);
    IF COALESCE((v_res->>'matched')::boolean, false) THEN
      v_matched := v_matched + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('esaminati', v_seen, 'agganciati', v_matched);
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_disp jsonb;
  v_group jsonb;
  v_bij jsonb;
  v_amt jsonb;
  v_close jsonb;
  v_util jsonb;
  v_riba jsonb;
BEGIN
  v_disp := public.rerun_distinta_reconciliation();
  v_group := public.rerun_group_reconciliation();
  v_bij := public.rerun_bijective_reconciliation();
  v_amt := public.rerun_amount_reconciliation();
  v_close := public.close_non_supplier_movements();
  v_util := public.close_utility_movements();
  v_riba := public.rerun_riba_provisional_close();
  RETURN jsonb_build_object('distinte', v_disp, 'granitici', v_group, 'biettivo', v_bij,
                            'importo_anonimo', v_amt, 'chiusi_non_fornitore', v_close,
                            'chiusi_utenze', v_util, 'riba_provvisorie', v_riba, 'run_at', now());
END;
$function$;

-- Le funzioni SECURITY DEFINER non devono essere raggiungibili da anon (vedi
-- migration 154): stesso trattamento per le nuove.
REVOKE ALL ON FUNCTION public.try_match_distinta_bank_transaction(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rerun_distinta_reconciliation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_match_distinta_bank_transaction(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rerun_distinta_reconciliation() TO authenticated, service_role;

COMMIT;
