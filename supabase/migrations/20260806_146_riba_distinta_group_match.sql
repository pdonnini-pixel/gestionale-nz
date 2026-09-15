-- ============================================================================
-- 20260806_146_riba_distinta_group_match.sql
-- FASE 2.1 — RiBa distinta: match per FORNITORE + effetti CUMULATIVI (a gruppo)
-- ----------------------------------------------------------------------------
-- I dati reali (distinta MPS "Ritiro Effetti Pagati") mostrano che:
--  - la chiave affidabile e' la P.IVA/CF del creditore, non il numero fattura
--    (in distinta e' sporco: "FT 73", "Rif- 5.7 8.962", "DOC.N....");
--  - molti effetti sono CUMULATIVI: un importo = somma di N fatture del fornitore,
--    senza un ponte affidabile sul numero fattura (numeri in distinta != payables);
--  - a volte la P.IVA in distinta e' un CODICE FISCALE che non combacia con
--    l'anagrafica (es. persona fisica) -> serve fallback sul nome.
--
-- Percio': l'automatico resta CONSERVATIVO (solo match a importo singolo, univoco).
-- Il resto lo COMPONE l'operatrice selezionando le RiBa aperte del fornitore, e la
-- conferma passa SOLO se la SOMMA delle selezionate quadra AL CENTESIMO (non a fiducia).
--
-- Additiva. Applicare su NZ + Made + Zago.
-- ============================================================================

BEGIN;

-- 1) Nuove colonne sulle righe distinta ---------------------------------------
ALTER TABLE public.riba_distinta_lines ADD COLUMN IF NOT EXISTS raw_vat text;
ALTER TABLE public.riba_distinta_lines ADD COLUMN IF NOT EXISTS matched_supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.riba_distinta_lines ADD COLUMN IF NOT EXISTS matched_payable_ids uuid[];

-- 2) Automatch conservativo: pre-aggancia SOLO il caso a importo singolo univoco.
--    Se la riga ha un fornitore risolto (matched_supplier_id, valorizzato dal
--    frontend per P.IVA/nome), cerca tra le SUE RiBa aperte/provvisorie una sola
--    con importo esatto; altrimenti tra tutte. >1 candidato o effetto cumulativo
--    -> 'ambiguous'/'unmatched' (composizione manuale).
CREATE OR REPLACE FUNCTION public.rpc_automatch_riba_distinta(p_distinta_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid; v_role text; v_line RECORD; v_match uuid; v_cnt integer;
  v_matched integer := 0; v_ambiguous integer := 0; v_unmatched integer := 0;
BEGIN
  SELECT company_id, role INTO v_company, v_role FROM public.user_profiles WHERE id = auth.uid();
  IF COALESCE(v_role,'') NOT IN ('super_advisor','contabile') THEN
    RAISE EXCEPTION 'Non autorizzato: serve il ruolo contabile o super_advisor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.riba_distinte d WHERE d.id = p_distinta_id AND d.company_id = v_company) THEN
    RAISE EXCEPTION 'Distinta non trovata o non accessibile';
  END IF;

  FOR v_line IN SELECT * FROM public.riba_distinta_lines WHERE distinta_id = p_distinta_id AND match_status <> 'confirmed' LOOP
    v_match := NULL; v_cnt := 0;
    IF v_line.raw_amount IS NOT NULL THEN
      CREATE TEMP TABLE _cand ON COMMIT DROP AS
        SELECT p.id
        FROM public.payables p
        LEFT JOIN public.suppliers s ON s.id = p.supplier_id
        WHERE p.company_id = v_company AND p.gross_amount > 0
          AND COALESCE(p.is_placeholder,false) = false AND p.bank_transaction_id IS NULL
          AND (p.status IN ('da_pagare','in_scadenza','scaduto') OR COALESCE(p.is_provisional_paid,false))
          AND COALESCE(p.payment_method::text, s.payment_method::text, s.default_payment_method::text) LIKE 'riba%'
          AND round(p.gross_amount * 100)::bigint = round(v_line.raw_amount * 100)::bigint
          AND (v_line.matched_supplier_id IS NULL OR p.supplier_id = v_line.matched_supplier_id);
      SELECT count(*) INTO v_cnt FROM _cand;
      IF v_cnt = 1 THEN SELECT id INTO v_match FROM _cand; END IF;
      DROP TABLE _cand;
    END IF;

    IF v_match IS NOT NULL THEN
      UPDATE public.riba_distinta_lines
        SET matched_payable_ids = ARRAY[v_match], matched_payable_id = v_match, match_status = 'matched'
        WHERE id = v_line.id;
      v_matched := v_matched + 1;
    ELSIF v_cnt > 1 THEN
      UPDATE public.riba_distinta_lines
        SET matched_payable_ids = NULL, matched_payable_id = NULL, match_status = 'ambiguous' WHERE id = v_line.id;
      v_ambiguous := v_ambiguous + 1;
    ELSE
      UPDATE public.riba_distinta_lines
        SET matched_payable_ids = NULL, matched_payable_id = NULL, match_status = 'unmatched' WHERE id = v_line.id;
      v_unmatched := v_unmatched + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('matched', v_matched, 'ambiguous', v_ambiguous, 'unmatched', v_unmatched);
END;
$function$;

-- 3) Conferma di UNA riga a GRUPPO: chiude N scadenze, gate sulla SOMMA al centesimo.
DROP FUNCTION IF EXISTS public.rpc_confirm_riba_distinta_line(uuid, uuid);
CREATE OR REPLACE FUNCTION public.rpc_confirm_riba_distinta_line(p_line_id uuid, p_payable_ids uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid; v_role text; v_line RECORD; v_sum numeric; v_cnt integer; v_bad integer; v_pid uuid; v_bank uuid;
BEGIN
  SELECT company_id, role INTO v_company, v_role FROM public.user_profiles WHERE id = auth.uid();
  IF COALESCE(v_role,'') NOT IN ('super_advisor','contabile') THEN
    RAISE EXCEPTION 'Non autorizzato: serve il ruolo contabile o super_advisor';
  END IF;
  SELECT * INTO v_line FROM public.riba_distinta_lines WHERE id = p_line_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Riga distinta non trovata o non accessibile'; END IF;
  IF p_payable_ids IS NULL OR array_length(p_payable_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Nessuna scadenza selezionata';
  END IF;

  -- tutte le scadenze devono essere della stessa azienda e RiBa
  SELECT count(*), coalesce(sum(gross_amount),0),
         count(*) FILTER (WHERE NOT public.fn_payable_is_riba(id))
    INTO v_cnt, v_sum, v_bad
  FROM public.payables WHERE id = ANY(p_payable_ids) AND company_id = v_company;
  IF v_cnt <> array_length(p_payable_ids, 1) THEN RAISE EXCEPTION 'Scadenze non trovate o di altra azienda'; END IF;
  IF v_bad > 0 THEN RAISE EXCEPTION 'NON_RIBA: una o piu'' scadenze non sono a ricevuta bancaria'; END IF;

  -- GATE AL CENTESIMO: la somma delle scadenze deve coincidere con l'importo della riga.
  IF v_line.raw_amount IS NULL OR round(v_sum * 100)::bigint <> round(v_line.raw_amount * 100)::bigint THEN
    RAISE EXCEPTION 'IMPORTO_NON_QUADRA: somma % vs distinta %', v_sum, v_line.raw_amount;
  END IF;

  v_bank := (SELECT bank_account_id FROM public.riba_distinte WHERE id = v_line.distinta_id);

  FOREACH v_pid IN ARRAY p_payable_ids LOOP
    UPDATE public.payables p
    SET amount_paid = p.gross_amount,
        payment_date = COALESCE(p.payment_date, v_line.raw_due_date, p.due_date),
        is_provisional_paid = false,
        payment_bank_account_id = COALESCE(p.payment_bank_account_id, v_bank)
    WHERE p.id = v_pid AND p.bank_transaction_id IS NULL;
    INSERT INTO public.payable_actions (payable_id, action_type, amount, note, performed_at)
    VALUES (v_pid, 'conferma_distinta_riba',
            (SELECT gross_amount FROM public.payables WHERE id = v_pid),
            'Confermata da distinta RiBa (riscontro importo al centesimo)', now());
  END LOOP;

  UPDATE public.riba_distinta_lines
    SET matched_payable_ids = p_payable_ids, matched_payable_id = p_payable_ids[1], match_status = 'confirmed'
    WHERE id = p_line_id;

  RETURN jsonb_build_object('ok', true, 'count', v_cnt, 'total', v_sum);
END;
$function$;

-- 4) Conferma DISTINTA in blocco: solo righe 'matched' con scadenze agganciate.
CREATE OR REPLACE FUNCTION public.rpc_confirm_riba_distinta(p_distinta_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_company uuid; v_role text; v_line RECORD;
  v_confirmed integer := 0; v_total numeric(14,2) := 0; v_skipped integer := 0;
BEGIN
  SELECT company_id, role INTO v_company, v_role FROM public.user_profiles WHERE id = auth.uid();
  IF COALESCE(v_role,'') NOT IN ('super_advisor','contabile') THEN
    RAISE EXCEPTION 'Non autorizzato: serve il ruolo contabile o super_advisor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.riba_distinte WHERE id = p_distinta_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Distinta non trovata o non accessibile';
  END IF;
  FOR v_line IN SELECT * FROM public.riba_distinta_lines
      WHERE distinta_id = p_distinta_id AND match_status = 'matched'
        AND matched_payable_ids IS NOT NULL AND array_length(matched_payable_ids,1) > 0 LOOP
    BEGIN
      PERFORM public.rpc_confirm_riba_distinta_line(v_line.id, v_line.matched_payable_ids);
      v_confirmed := v_confirmed + 1;
      v_total := v_total + COALESCE(v_line.raw_amount, 0);
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;
  UPDATE public.riba_distinte SET status = 'confermata', confirmed_at = now(), matched_count = v_confirmed, matched_total = v_total WHERE id = p_distinta_id;
  RETURN jsonb_build_object('confirmed', v_confirmed, 'skipped', v_skipped, 'total', v_total);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_confirm_riba_distinta_line(uuid, uuid[]) TO authenticated;

COMMIT;
