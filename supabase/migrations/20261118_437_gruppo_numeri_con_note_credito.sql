-- 437 — Motore: un bonifico che elenca in causale fatture e note di credito dello stesso fornitore si
-- aggancia da solo, anche con numeri corti. NZ + Zago.
--
-- Il fatto (Zago, 18/11/2026): i bonifici BCC a GGZ scrivono «GGZ SF 7184-7322-...-9468 NC 9527-7971»
-- e pagano esattamente fatture meno note di credito. try_match_group_numbers_bank_transaction non li
-- prendeva: esclude le note di credito (gross_amount > 0) e vuole numeri di almeno 6 cifre, mentre GGZ
-- scrive «7184» per la fattura «7184/01». Su NZ gli stessi pagamenti erano stati agganciati a mano.
--
-- Regola nuova (try_match_group_cited_nc_bank_transaction), passaggio in più dopo i due esistenti, che
-- restano come sono:
--   * la causale (statement_description, altrimenti description) nomina il fornitore: P.IVA o parola
--     distintiva (supplier_confirmed_in_text), oppure la prima parola della ragione sociale (>= 3 lettere)
--     come parola intera (GGZ);
--   * i documenti sono quelli il cui numero è citato come numero intero (>= 3 cifre, chiavi di
--     invoice_number_keys: 7184 vale per 7184/01): fatture aperte e note di credito senza movimento;
--   * documenti non successivi al bonifico; almeno due documenti, almeno una fattura;
--   * fatture meno note di credito = netto del bonifico entro 0,05; un solo fornitore che torna.
-- L'aggancio lo fa reconcile_movement_group (stessa scrittura dell'abbinamento a mano), poi il registro
-- passa ad «auto_exact» con la nota della regola.
-- Misura prima di applicare: Zago, sullo stato salvato prima del caricamento BCC, trova i 4 bonifici GGZ
-- (30 documenti) e nient'altro; NZ, sui 67 pagamenti a più documenti già chiusi, ne ritrova 14 e in
-- tutti e 14 sceglie gli stessi documenti agganciati allora. Oggi su NZ e Zago non aggancia niente.

CREATE OR REPLACE FUNCTION public.try_match_group_cited_nc_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD;
  v_c text;
  v_net numeric;
  v_ids uuid[];
  v_n int;
  v_res jsonb;
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing');
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;
  v_c := upper(COALESCE(NULLIF(v_bt.statement_description, ''), v_bt.description, ''));
  v_net := COALESCE(public.bank_movement_net(COALESCE(v_bt.description, '')), abs(v_bt.amount));

  WITH cand AS (
    SELECT p.id, COALESCE(NULLIF(p.supplier_vat, ''), upper(p.supplier_name)) AS sk, p.gross_amount,
           CASE WHEN p.gross_amount < 0 THEN p.gross_amount
                ELSE COALESCE(p.amount_remaining, p.gross_amount - COALESCE(p.amount_paid, 0)) END AS amt
    FROM public.payables p
    WHERE p.company_id = v_bt.company_id
      AND p.bank_transaction_id IS NULL
      AND COALESCE(p.is_placeholder, false) = false
      AND ((p.gross_amount > 0 AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto'))
           OR (p.gross_amount < 0 AND p.status = 'nota_credito'))
      AND (p.invoice_date IS NULL OR p.invoice_date <= v_bt.transaction_date)
      AND public.invoice_cited_in_text(COALESCE(p.invoice_number, ''), v_c, 3)
      AND (public.supplier_confirmed_in_text(p.supplier_name, p.supplier_vat, v_c)
           OR (length(split_part(regexp_replace(COALESCE(p.supplier_name, ''), '[^A-Za-z0-9 ]', '', 'g'), ' ', 1)) >= 3
               AND v_c ~ ('(^|[^A-Z0-9])' || split_part(upper(regexp_replace(COALESCE(p.supplier_name, ''), '[^A-Za-z0-9 ]', '', 'g')), ' ', 1) || '([^A-Z0-9]|$)')))
  ), grp AS (
    SELECT sk, array_agg(id) AS ids, sum(amt) AS tot
    FROM cand GROUP BY sk
    HAVING count(*) >= 2 AND count(*) FILTER (WHERE gross_amount > 0) >= 1
       AND abs(sum(amt) - v_net) <= 0.05
  )
  SELECT (SELECT count(*) FROM grp), (SELECT ids FROM grp LIMIT 1) INTO v_n, v_ids;

  IF COALESCE(v_n, 0) <> 1 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'ambiguous_or_none', 'gruppi', COALESCE(v_n, 0));
  END IF;

  v_res := public.reconcile_movement_group(p_bt_id, v_ids);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'group_refused', 'detail', v_res);
  END IF;

  UPDATE public.reconciliation_log
     SET match_type = 'auto_exact',
         notes = 'auto (437): fatture e note di credito citate in causale, somma esatta — ' || COALESCE(notes, '')
   WHERE bank_transaction_id = p_bt_id AND payable_id = ANY(v_ids) AND status = 'applied' AND match_type = 'manual';

  RETURN jsonb_build_object('matched', true, 'auto', true, 'grouped', true,
                            'linked', (v_res->>'linked')::int, 'by', 'cited_numbers_with_nc');
END;
$function$;
REVOKE ALL ON FUNCTION public.try_match_group_cited_nc_bank_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_match_group_cited_nc_bank_transaction(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rerun_group_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  r RECORD;
  v_proc INT := 0;
  v_match INT := 0;
  v_linked INT := 0;
  v_res jsonb;
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  PERFORM public.richiedi_profilo_gestionale(); -- migration 364
  FOR r IN
    SELECT id FROM public.bank_transactions
    WHERE amount < 0 AND status IN ('posted', 'booked') AND COALESCE(is_reconciled, false) = false
  LOOP
    v_proc := v_proc + 1;
    v_res := public.try_match_group_bank_transaction(r.id);
    IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
      v_res := public.try_match_group_numbers_bank_transaction(r.id);
    END IF;
    -- 437: fatture e note di credito citate in causale, anche con numeri corti.
    IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
      v_res := public.try_match_group_cited_nc_bank_transaction(r.id);
    END IF;
    IF COALESCE((v_res->>'matched')::boolean, false) THEN
      v_match := v_match + 1;
      v_linked := v_linked + COALESCE((v_res->>'linked')::int, 0);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('processed', v_proc, 'matched', v_match, 'fatture_agganciate', v_linked);
END;
$function$;
