-- =====================================================================
-- Migrazione 110 — Riconciliazione: flussi CBI ANONIMI + scorporo COMMISSIONI
-- =====================================================================
-- REGOLA (Patrizio, 2026-07-24): "Si deve poter chiudere a mano, ma SEMPRE —
-- ripeto sempre — quando arriva un movimento il sistema deve verificare tra le
-- fatture APERTE E CHIUSE se c'e' corrispondenza. E non deve saltare per colpa
-- delle commissioni: se cerchi l'importo preciso al centesimo, la commissione
-- bancaria te lo fa mancare."
--
-- CAUSA RADICE (caso reale New Zago, 13/07/2026):
--   • Bonifici a SP CONTABILE (322/E, 2.750,00) e STUDIO POLI (SP_54, 3.057,74)
--     arrivati come flusso CBI aziendale con causale ANONIMA:
--       "Causale: DISPOSIZIONE - FILIALE DISPONENTE 2430 ID FLUSSO CBI: 135696230
--        NUM. TOT. PAGAMENTI: 1  IMPORTO BONIFICI: 2.750,00  IMPORTO COMMISSIONI: 1,75"
--     -> NESSUN nome fornitore, NESSUN numero fattura in causale.
--   • I tre matcher esistenti (granitico 102, a punteggio 100, biettivo 104)
--     richiedono TUTTI che il fornitore sia riconoscibile in causale (P.IVA o una
--     parola >=4 char del nome). Con la causale anonima non scattano mai.
--   • In piu' l'importo in banca e' LORDO (2.751,75 = 2.750,00 + 1,75 commissione),
--     quindi anche un match sull'importo esatto fallirebbe.
-- Risultato: le fatture erano gia' "chiuse a mano" (da uno script di
-- regolarizzazione), i bonifici reali restavano orfani, e nessuno univa i due
-- lati. Se ne e' dovuto accorgere Patrizio a mano. Questo chiude il buco.
--
-- SOLUZIONE — quarto tentativo di match, DOPO granitico/punteggio/biettivo, per i
-- movimenti in uscita non ancora riconciliati:
--   1) legge dalla causale l'importo NETTO realmente bonificato ("IMPORTO BONIFICI")
--      e la commissione ("IMPORTO COMMISSIONI"), cosi' la commissione non fa piu'
--      saltare l'abbinamento (si confronta il netto, non il lordo);
--   2) cerca fatture non agganciate — APERTE **oppure** CHIUSE A MANO — con lo
--      stesso importo (netto dichiarato, oppure lordo-commissione, oppure lordo;
--      tolleranza stretta 0,02 o 0,3%) dentro una finestra temporale coerente;
--   3) siccome la causale NON conferma il fornitore, l'aggancio automatico scatta
--      SOLO quando il candidato e' UNICO **e** o e' una fattura chiusa a mano
--      (aggancio puro, nessuna doppia scrittura) o l'importo netto arriva dal dato
--      strutturato "IMPORTO BONIFICI" (esatto). In tutti gli altri casi (candidato
--      unico ma debole, oppure piu' candidati) NON chiude nulla: PROPONE
--      (to_confirm) cosi' l'abbinamento compare in cima alla coda "da riconciliare"
--      e basta un click. Nessuno deve piu' andare a cercarlo a mano.
--
-- Additiva/idempotente (CREATE OR REPLACE). NON distruttiva: gli agganci sono
-- reversibili con undo_reconcile_movement; le fatture chiuse a mano restano
-- 'pagato' (solo bank_transaction_id valorizzato). Rollback dedicato a fianco.
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago.
-- Dopo l'apply, per l'abbinamento dello STORICO (sicuro: auto solo se univoco):
--     SELECT public.rerun_amount_reconciliation();
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Matcher per singolo movimento: importo netto (scorporo commissione),
--    aperte + chiuse a mano, auto solo se univoco, altrimenti proposta.
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
  v_gross NUMERIC;
  v_net NUMERIC := NULL;        -- da "IMPORTO BONIFICI"
  v_comm NUMERIC := NULL;       -- da "IMPORTO COMMISSIONI"
  v_structured BOOLEAN := false; -- netto letto dal dato strutturato di causale
  v_targets NUMERIC[] := ARRAY[]::numeric[];
  v_cand RECORD;
  v_n INT := 0;
  v_only RECORD;
  v_only_closed BOOLEAN;
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
  v_gross := abs(v_bt.amount);

  -- Parsing importi dalla causale CBI (formato IT: 2.750,00 / 1,75).
  m := (regexp_match(v_descr, 'IMPORTO\s+BONIFICI\s*:?\s*([0-9][0-9.]*,[0-9]{2})', 'i'))[1];
  IF m IS NOT NULL THEN
    v_net := replace(replace(m, '.', ''), ',', '.')::numeric;
    v_structured := true;
  END IF;
  m := (regexp_match(v_descr, 'IMPORTO\s+COMMISSIONI\s*:?\s*([0-9][0-9.]*,[0-9]{2})', 'i'))[1];
  IF m IS NOT NULL THEN
    v_comm := replace(replace(m, '.', ''), ',', '.')::numeric;
  END IF;

  -- Importi-obiettivo da confrontare col LORDO fattura (gross_amount):
  --   • netto dichiarato in causale (esatto), se presente;
  --   • lordo movimento meno commissione dichiarata;
  --   • lordo movimento (fallback quando non c'e' nulla di strutturato).
  IF v_net IS NOT NULL THEN v_targets := v_targets || v_net; END IF;
  IF v_comm IS NOT NULL THEN v_targets := v_targets || (v_gross - v_comm); END IF;
  v_targets := v_targets || v_gross;

  -- Conta i candidati (aperte o chiuse a mano, non ancora agganciate) con lo stesso
  -- importo di uno qualsiasi dei target e in finestra temporale. Nessun vincolo su
  -- fornitore (causale anonima) -> l'unicita' e' la garanzia anti-falso-positivo.
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
      AND EXISTS (
        SELECT 1 FROM unnest(v_targets) t
        WHERE abs(p.gross_amount - t) <= GREATEST(0.02, t * 0.003))
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

  v_only_closed := (v_n = 1 AND v_only.status = 'pagato' AND COALESCE(v_only.closed_manually, false));

  -- CASO GRANITICO: candidato UNICO e (chiuso a mano -> solo aggancio, sempre
  -- sicuro) OPPURE (netto letto dal dato strutturato "IMPORTO BONIFICI" -> esatto).
  IF v_n = 1 AND (v_only_closed OR v_structured) THEN
    IF v_only_closed THEN
      UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = v_only.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_bt.company_id, p_bt_id, v_only.id, 'auto_exact', 95, 'applied', v_only.gross_amount,
              'auto: importo netto univoco da flusso CBI anonimo (commissione scorporata) — fattura chiusa a mano, solo aggancio');
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
              'auto: importo netto univoco da flusso CBI anonimo (IMPORTO BONIFICI, commissione scorporata)');
    END IF;

    UPDATE public.bank_transactions
    SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_only.id
    WHERE id = p_bt_id;

    RETURN jsonb_build_object('matched', true, 'auto', true, 'payable_id', v_only.id,
                              'amount', v_only.gross_amount, 'net_parsed', v_net, 'commission', v_comm);
  END IF;

  -- ALTRIMENTI (unico ma debole, oppure piu' candidati): PROPONE, non chiude.
  -- Evita duplicati di proposta per la stessa coppia (movimento, fattura).
  INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
  SELECT v_bt.company_id, p_bt_id, p.id, 'auto_fuzzy', 60, 'to_confirm', p.gross_amount,
         'proposta: importo compatibile (flusso CBI anonimo, commissione scorporata) — conferma manuale'
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
    AND EXISTS (
      SELECT 1 FROM unnest(v_targets) t
      WHERE abs(p.gross_amount - t) <= GREATEST(0.02, t * 0.003))
    AND v_bt.transaction_date
          BETWEEN COALESCE(p.invoice_date, p.due_date, v_bt.transaction_date) - INTERVAL '120 days'
              AND COALESCE(p.due_date, p.invoice_date, v_bt.transaction_date) + INTERVAL '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.reconciliation_log rl
      WHERE rl.bank_transaction_id = p_bt_id AND rl.payable_id = p.id
        AND rl.status IN ('applied', 'to_confirm'));

  RETURN jsonb_build_object('matched', false, 'proposed', v_n, 'reason', 'ambiguous_proposed');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.try_match_amount_bank_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_match_amount_bank_transaction(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2) Batch: applica il matcher a importo sullo storico non riconciliato.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rerun_amount_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r RECORD;
  v_proc INT := 0;
  v_auto INT := 0;
  v_prop INT := 0;
  v_res jsonb;
BEGIN
  FOR r IN
    SELECT id FROM public.bank_transactions
    WHERE amount < 0 AND status IN ('posted', 'booked') AND COALESCE(is_reconciled, false) = false
  LOOP
    v_proc := v_proc + 1;
    v_res := public.try_match_amount_bank_transaction(r.id);
    IF COALESCE((v_res->>'auto')::boolean, false) THEN
      v_auto := v_auto + 1;
    ELSIF COALESCE((v_res->>'proposed')::int, 0) > 0 THEN
      v_prop := v_prop + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('processed', v_proc, 'auto_linked', v_auto, 'proposte', v_prop);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rerun_amount_reconciliation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rerun_amount_reconciliation() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3) Cron giornaliero: aggiunge il passo "importo anonimo" dopo granitico + biettivo.
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
BEGIN
  v_group := public.rerun_group_reconciliation();
  v_bij := public.rerun_bijective_reconciliation();
  v_amt := public.rerun_amount_reconciliation();
  RETURN jsonb_build_object('granitici', v_group, 'biettivo', v_bij, 'importo_anonimo', v_amt, 'run_at', now());
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.run_daily_reconciliation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_daily_reconciliation() TO service_role;

-- ---------------------------------------------------------------------
-- 4) Trigger: terzo fallback a ogni movimento (granitico -> punteggio -> importo).
--    Cosi' un bonifico anonimo viene agganciato/proposto SUBITO, non solo di notte.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_auto_reconcile_bank_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF NEW.status IN ('posted', 'booked') AND NEW.amount < 0 THEN
    v_res := public.try_match_group_bank_transaction(NEW.id);
    IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
      v_res := public.try_match_bank_transaction(NEW.id);
      IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
        PERFORM public.try_match_amount_bank_transaction(NEW.id);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
