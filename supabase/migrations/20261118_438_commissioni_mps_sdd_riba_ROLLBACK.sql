-- ROLLBACK 438 — NZ + Zago. Il giro notturno torna senza il passaggio delle commissioni MPS; le tre
-- funzioni nuove restano ma nessuno le chiama. Gli agganci già fatti restano (si annullano uno per uno
-- dal gestionale; stato precedente su Zago in _bkp_438_payables_20261118).
CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_disp jsonb; v_group jsonb; v_cum jsonb; v_bij jsonb; v_amt jsonb; v_close jsonb;
  v_util jsonb; v_riba jsonb; v_cash jsonb; v_fisc jsonb; v_cat jsonb;
  v_t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  PERFORM public.richiedi_profilo_gestionale(); -- migration 364
  SET LOCAL statement_timeout = '20min';

  v_disp := public.rerun_distinta_reconciliation();
  v_group := public.rerun_group_reconciliation();
  v_cum := public.rerun_cumulative_reconciliation();
  v_bij := public.rerun_bijective_reconciliation();
  v_amt := public.rerun_amount_reconciliation();
  v_close := public.close_non_supplier_movements();
  v_util := public.close_utility_movements();
  v_riba := public.rerun_riba_provisional_close();
  v_cash := public.rerun_cash_card_provisional_close();
  v_fisc := public.close_paid_fiscal_deadlines();
  v_cat := public.clean_bank_category_conflicts();

  RETURN jsonb_build_object('distinte', v_disp, 'granitici', v_group, 'cumulativi', v_cum,
                            'biettivo', v_bij,
                            'importo_anonimo', v_amt, 'chiusi_non_fornitore', v_close,
                            'chiusi_utenze', v_util, 'riba_provvisorie', v_riba,
                            'contanti_carte_provvisorie', v_cash,
                            'scadenze_fiscali', v_fisc, 'etichette', v_cat,
                            'run_at', now(),
                            'durata_sec', round(extract(epoch from (clock_timestamp() - v_t0))::numeric, 1));
END;
$function$;
