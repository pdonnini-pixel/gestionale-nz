-- =====================================================================
-- ROLLBACK Migrazione 110 — rimuove il matcher a importo (flussi CBI anonimi)
-- e ripristina run_daily_reconciliation (105) e il trigger (103) precedenti.
-- =====================================================================
-- NB: gli agganci gia' creati dal matcher restano (sono in reconciliation_log e
-- payables.bank_transaction_id); per disfarli usare undo_reconcile_movement caso
-- per caso. Questo rollback rimuove solo la LOGICA, non tocca i dati.
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago.
-- =====================================================================

-- 1) run_daily_reconciliation torna alla versione 105 (senza passo "importo anonimo").
CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_group jsonb;
  v_bij jsonb;
BEGIN
  v_group := public.rerun_group_reconciliation();
  v_bij := public.rerun_bijective_reconciliation();
  RETURN jsonb_build_object('granitici', v_group, 'biettivo', v_bij, 'run_at', now());
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.run_daily_reconciliation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_daily_reconciliation() TO service_role;

-- 2) Trigger torna alla versione 103 (granitico -> punteggio, senza fallback a importo).
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
      PERFORM public.try_match_bank_transaction(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 3) Rimuove le funzioni introdotte dalla 110.
DROP FUNCTION IF EXISTS public.rerun_amount_reconciliation();
DROP FUNCTION IF EXISTS public.try_match_amount_bank_transaction(uuid);
