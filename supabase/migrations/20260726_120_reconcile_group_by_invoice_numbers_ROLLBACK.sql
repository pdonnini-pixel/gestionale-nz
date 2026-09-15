-- ROLLBACK migrazione 120 — rimuove il matcher guidato dai numeri e ripristina
-- rerun_group_reconciliation (solo matcher a nome) e close_utility_movements (119).

CREATE OR REPLACE FUNCTION public.rerun_group_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r RECORD;
  v_proc INT := 0;
  v_match INT := 0;
  v_linked INT := 0;
  v_res jsonb;
BEGIN
  FOR r IN
    SELECT id FROM public.bank_transactions
    WHERE amount < 0 AND status IN ('posted', 'booked') AND COALESCE(is_reconciled, false) = false
  LOOP
    v_proc := v_proc + 1;
    v_res := public.try_match_group_bank_transaction(r.id);
    IF COALESCE((v_res->>'matched')::boolean, false) THEN
      v_match := v_match + 1;
      v_linked := v_linked + COALESCE((v_res->>'linked')::int, 0);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('processed', v_proc, 'matched', v_match, 'fatture_agganciate', v_linked);
END;
$function$;

-- close_utility_movements torna alla versione 119 (senza la guardia sui numeri fattura)
CREATE OR REPLACE FUNCTION public.close_utility_movements()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n INT;
BEGIN
  WITH upd AS (
    UPDATE public.bank_transactions bt
    SET is_reconciled = true,
        reconciled_at = now(),
        category = COALESCE(bt.category, 'utenze'),
        note = COALESCE(bt.note || ' | ', '') || 'chiuso automaticamente (utenza — addebito permanente)'
    WHERE bt.amount < 0
      AND COALESCE(bt.is_reconciled, false) = false
      AND bt.status IN ('posted', 'booked')
      AND NOT EXISTS (
        SELECT 1 FROM public.reconciliation_log rl
        WHERE rl.bank_transaction_id = bt.id AND rl.status IN ('applied', 'to_confirm'))
      AND EXISTS (
        SELECT 1 FROM public.suppliers s
        WHERE s.company_id = bt.company_id
          AND COALESCE(s.is_utility, false) = true
          AND public.supplier_confirmed_in_text_strict(
                s.name, COALESCE(s.vat_number, s.partita_iva),
                coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '')))
    RETURNING bt.id
  )
  SELECT count(*) INTO v_n FROM upd;
  RETURN jsonb_build_object('chiusi_utenze', v_n);
END;
$function$;

DROP FUNCTION IF EXISTS public.try_match_group_numbers_bank_transaction(uuid);
