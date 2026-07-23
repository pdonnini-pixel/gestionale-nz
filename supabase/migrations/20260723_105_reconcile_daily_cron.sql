-- =====================================================================
-- Migrazione 105 — Riconciliazione automatica giornaliera (cron)
-- =====================================================================
-- Rende PERMANENTI e AUTOMATICHE le regole di riconciliazione sullo storico:
--   • try_match_group_bank_transaction (granitico) e try_match_bank_transaction
--     (a punteggio) girano GIÀ nel trigger a ogni nuovo movimento inserito;
--   • MANCAVA l'automatismo per l'abbinamento BIETTIVO per data (ricorrenti tipo
--     Trenitalia/Telepass/SPM/NEXI), che era solo batch manuale.
--
-- Questo cron esegue ogni notte (dopo la sync Open Banking) i due batch idempotenti
-- sui movimenti ancora non riconciliati: prima i gruppi granitici, poi l'abbinamento
-- biettivo per data. Additivo/reversibile: non chiude mai nulla di incerto (solo
-- casi certi: fornitore+numero in causale, oppure 1-a-1 per data stesso importo).
--
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago.
-- =====================================================================

-- Wrapper: esegue i due batch in sequenza.
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

-- Schedulazione giornaliera 05:45 UTC (dopo la sync OB). Idempotente: rimuove
-- l'eventuale job omonimo prima di ricrearlo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-recurring-daily') THEN
    PERFORM cron.unschedule('reconcile-recurring-daily');
  END IF;
  PERFORM cron.schedule('reconcile-recurring-daily', '45 5 * * *', 'SELECT public.run_daily_reconciliation();');
END$$;
