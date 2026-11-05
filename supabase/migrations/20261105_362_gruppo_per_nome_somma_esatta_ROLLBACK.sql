-- ROLLBACK della migrazione 362: rerun_group_reconciliation torna com'era (senza il
-- gruppo per nome). try_match_group_name_bank_transaction resta ma nessuno la chiama;
-- per toglierla del tutto: DROP FUNCTION public.try_match_group_name_bank_transaction(uuid);
-- Nessun dato toccato. NZ + Zago.

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

COMMIT;
