-- 20260921_244 — Ripristina la chiusura automatica delle scadenze fiscali
--
-- PROBLEMA (visto in Fabbisogno il 21/09/2026)
-- La pagina Fabbisogno continuava a chiedere di pagare l'F24 ritenute/contributi
-- di agosto (33.266,62), l'IVA di agosto (24.416,02), la rata IRAP (9.195,16) e
-- il residuo IVA di luglio (33,84): tutte con scadenza 16/09/2026 e tutte gia'
-- addebitate in banca lo stesso 16/09, con importo identico al centesimo.
--
-- CAUSA
-- La migration 20260903_164 ha riscritto run_daily_reconciliation() e, nel farlo,
-- ha perso la chiamata a close_paid_fiscal_deadlines() introdotta dalla 109. Da
-- quel giorno il cron chiude il lato banca (close_non_supplier_movements marca il
-- movimento come riconciliato, categoria "tasse") ma nessuno chiude il lato
-- scadenza: fiscal_deadlines resta 'pending' e la scadenza ricompare come da
-- pagare. La funzione close_paid_fiscal_deadlines() e' rimasta nel DB, orfana.
--
-- FIX
-- Rimettere la chiamata nella catena giornaliera, dopo le chiusure non-fornitore
-- (che categorizzano i movimenti di imposte) e prima del riepilogo.
-- Nessuna modifica ai dati qui dentro: solo la funzione di orchestrazione.

CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_disp jsonb;
  v_group jsonb;
  v_bij jsonb;
  v_amt jsonb;
  v_close jsonb;
  v_util jsonb;
  v_riba jsonb;
  v_cash jsonb;
  v_fisc jsonb;
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
  -- Scadenze fiscali gia' addebitate in banca (F24, IVA, IRAP, INPS, TARI...).
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

REVOKE ALL ON FUNCTION public.run_daily_reconciliation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_daily_reconciliation() FROM anon;
GRANT EXECUTE ON FUNCTION public.run_daily_reconciliation() TO authenticated, service_role;

-- Verifica:
--   SELECT pg_get_functiondef(oid) ILIKE '%close_paid_fiscal_deadlines%'
--   FROM pg_proc WHERE proname = 'run_daily_reconciliation';
