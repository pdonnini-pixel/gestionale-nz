-- ROLLBACK di 20260904_171_reconcile_cron_statement_timeout.sql
-- Rimette la funzione com'era: senza SET LOCAL statement_timeout e senza durata_sec.
-- Da usare solo se il job lungo dovesse dare fastidio ad altro; sappiendo che
-- cosi' torna a fallire ogni notte su NZ.

CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_disp jsonb; v_group jsonb; v_bij jsonb; v_amt jsonb;
  v_close jsonb; v_util jsonb; v_riba jsonb;
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
