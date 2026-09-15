-- ROLLBACK di 20260909_194 — toglie la chiusura provvisoria di contanti e carte.
--
-- 1) rimette run_daily_reconciliation com'era (senza il giro contanti/carte);
-- 2) elimina le tre funzioni nuove;
-- 3) riapre le scadenze chiuse in via provvisoria da questa regola, riconoscibili dalla
--    riga di audit 'chiusura_provvisoria_cassa_carte' in payable_actions. NON tocca le
--    RiBa provvisorie né le chiusure fatte a mano.

CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_disp jsonb; v_group jsonb; v_bij jsonb; v_amt jsonb;
  v_close jsonb; v_util jsonb; v_riba jsonb;
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
  RETURN jsonb_build_object('distinte', v_disp, 'granitici', v_group, 'biettivo', v_bij,
                            'importo_anonimo', v_amt, 'chiusi_non_fornitore', v_close,
                            'chiusi_utenze', v_util, 'riba_provvisorie', v_riba,
                            'run_at', now(),
                            'durata_sec', round(extract(epoch from (clock_timestamp() - v_t0))::numeric, 1));
END;
$function$;
REVOKE ALL ON FUNCTION public.run_daily_reconciliation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_daily_reconciliation() FROM anon;
GRANT EXECUTE ON FUNCTION public.run_daily_reconciliation() TO authenticated, service_role;

UPDATE public.payables p
   SET amount_paid = 0, payment_date = NULL,
       is_provisional_paid = false, provisional_paid_at = NULL
 WHERE COALESCE(p.is_provisional_paid, false)
   AND p.bank_transaction_id IS NULL
   AND EXISTS (SELECT 1 FROM public.payable_actions a
                WHERE a.payable_id = p.id AND a.action_type = 'chiusura_provvisoria_cassa_carte');

DROP FUNCTION IF EXISTS public.rpc_cash_card_provisional_close_backlog();
DROP FUNCTION IF EXISTS public.rerun_cash_card_provisional_close();
DROP FUNCTION IF EXISTS public.fn_cash_card_provisional_close(uuid, boolean);
