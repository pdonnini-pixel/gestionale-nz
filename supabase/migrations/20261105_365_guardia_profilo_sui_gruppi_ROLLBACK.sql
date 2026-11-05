-- ROLLBACK della migrazione 365: le due funzioni tornano senza la guardia del profilo,
-- com'erano dopo 20261105_364_gruppo_per_nome_solo_proposta. Nessun dato toccato.

BEGIN;

CREATE OR REPLACE FUNCTION public.rerun_group_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE r RECORD; v_proc INT := 0; v_match INT := 0; v_linked INT := 0; v_res jsonb;
BEGIN
  FOR r IN SELECT id FROM public.bank_transactions WHERE amount < 0 AND status IN ('posted', 'booked') AND COALESCE(is_reconciled, false) = false LOOP
    v_proc := v_proc + 1;
    v_res := public.try_match_group_bank_transaction(r.id);
    IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN v_res := public.try_match_group_numbers_bank_transaction(r.id); END IF;
    IF COALESCE((v_res->>'matched')::boolean, false) THEN v_match := v_match + 1; v_linked := v_linked + COALESCE((v_res->>'linked')::int, 0); END IF;
  END LOOP;
  RETURN jsonb_build_object('processed', v_proc, 'matched', v_match, 'fatture_agganciate', v_linked);
END;
$function$;

CREATE OR REPLACE FUNCTION public.try_match_group_name_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
-- 364: sola lettura. Segnala il gruppo (fornitore in causale, tutte le sue scadenze
-- aperte fino a 15 giorni dopo il bonifico, somma esatta) senza chiudere niente.
-- La conferma la dà una persona dal riquadro «Pagamenti raggruppati» di Banche.
DECLARE
  v_bt RECORD; v_descr TEXT; v_head TEXT; v_mov NUMERIC; v_grp RECORD;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing'); END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled'); END IF;
  IF public.fn_bank_own_movement(v_bt.description) THEN RETURN jsonb_build_object('matched', false, 'reason', 'movimento_della_banca'); END IF;

  -- Causale che cita un numero di fattura: decidono i motori dei numeri, non il nome.
  v_head := split_part(regexp_replace(upper(coalesce(v_bt.description, '')), 'ID\.?\s?BON', '§', 'g'), '§', 1);
  IF v_head ~ '(^|[^A-Z])((FATTUR[AE]|FATT|FT)\.?\s*(N\.?|N°|NR\.?|NUM\.?|NUMERO)?\s*[-.:#°]?\s*[A-Z]{0,3}[0-9]|(S?SF|NC|CF)-\s*[A-Z]{0,3}[0-9])' THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'causale_con_numero_fattura');
  END IF;

  v_descr := lower(coalesce(v_bt.description, '') || ' ' || coalesce(v_bt.counterpart, '') || ' '
                   || coalesce(v_bt.merchant_name, '') || ' ' || coalesce(v_bt.statement_description, ''));
  v_mov := abs(v_bt.amount);

  SELECT g.k, g.ids, g.tot, g.n, g.sup, count(*) OVER () AS n_grp INTO v_grp
  FROM (
    SELECT COALESCE(p.supplier_vat, p.supplier_name) AS k, array_agg(p.id) AS ids,
           sum(p.amount_remaining) AS tot, count(*) AS n, max(p.supplier_name) AS sup
    FROM public.payables p
    WHERE p.company_id = v_bt.company_id
      AND p.bank_transaction_id IS NULL
      AND p.gross_amount > 0
      AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto')
      AND p.amount_remaining > 0
      AND p.invoice_date IS NOT NULL
      AND p.invoice_date <= v_bt.transaction_date + 15
      AND p.supplier_name IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.payable_credit_note_links l
                      WHERE l.payable_id = p.id AND l.status = 'pending')
      AND public.supplier_confirmed_in_text(p.supplier_name, p.supplier_vat, v_descr)
    GROUP BY COALESCE(p.supplier_vat, p.supplier_name)
    HAVING count(*) >= 2 AND abs(sum(p.amount_remaining) - v_mov) <= 0.02
  ) g
  LIMIT 1;

  IF NOT FOUND OR v_grp.n_grp <> 1 THEN
    RETURN jsonb_build_object('matched', false, 'gruppi', CASE WHEN FOUND THEN v_grp.n_grp ELSE 0 END);
  END IF;

  -- matched resta false: è una segnalazione, nessuno deve trattarla come aggancio fatto.
  RETURN jsonb_build_object('matched', false, 'proposta', true, 'payable_ids', to_jsonb(v_grp.ids),
                            'supplier', v_grp.sup, 'sum', v_grp.tot, 'movimento', v_mov);
END;
$function$;

-- Nessuno la chiama dal browser né dalle Edge Function: resta solo al ruolo di servizio.
REVOKE EXECUTE ON FUNCTION public.try_match_group_name_bank_transaction(uuid) FROM authenticated;

COMMIT;
