-- ROLLBACK 20260921_245
-- Toglie la guardia dalla catena notturna e la funzione. NON rimette l'etichetta
-- 'spese_banca' sui bonifici: era sbagliata, e i movimenti restano senza categoria
-- (che e' il loro stato corretto finche' non vengono agganciati a una fattura).

CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_disp jsonb; v_group jsonb; v_bij jsonb; v_amt jsonb; v_close jsonb;
  v_util jsonb; v_riba jsonb; v_cash jsonb; v_fisc jsonb;
  v_t0 timestamptz := clock_timestamp();
BEGIN
  SET LOCAL statement_timeout = '20min';

  v_disp := public.rerun_distinta_reconciliation();
  v_group := public.rerun_group_reconciliation();
  v_bij := public.rerun_bijective_reconciliation();
  v_amt := public.rerun_amount_reconciliation();
  v_close := public.close_non_supplier_movements();
  v_util := public.close_utility_movements();
  v_riba := public.rerun_riba_provisional_close();
  v_cash := public.rerun_cash_card_provisional_close();
  v_fisc := public.close_paid_fiscal_deadlines();

  RETURN jsonb_build_object('distinte', v_disp, 'granitici', v_group, 'biettivo', v_bij,
                            'importo_anonimo', v_amt, 'chiusi_non_fornitore', v_close,
                            'chiusi_utenze', v_util, 'riba_provvisorie', v_riba,
                            'contanti_carte_provvisorie', v_cash,
                            'scadenze_fiscali', v_fisc,
                            'run_at', now(),
                            'durata_sec', round(extract(epoch from (clock_timestamp() - v_t0))::numeric, 1));
END;
$function$;

DROP FUNCTION IF EXISTS public.clean_bank_category_conflicts();
