-- =====================================================================
-- Migrazione 379 — Il responsabile non chiama le funzioni di banca e fatture
-- =====================================================================
-- Dalla revisione di sicurezza della 378: il recinto copre le tabelle, ma
-- molte funzioni SECURITY DEFINER del ciclo passivo e della banca girano
-- come proprietario e controllano solo che l'utente abbia un profilo
-- (richiedi_profilo_gestionale, migration 364) o nemmeno quello. Un
-- responsabile, chiamandole direttamente con il suo token, poteva forzare o
-- disfare riconciliazioni e scrivere sui movimenti.
--
-- COSA FA (solo per il ruolo 'responsabile', che oggi non ha utenti: per
-- tutti gli altri ruoli nulla cambia):
--   1. responsabile_non_qui(): errore 42501 se chi chiama e' un responsabile.
--   2. richiedi_profilo_gestionale() la chiama: copre le 38 funzioni che la
--      usano (riconciliazioni, chiusure, rerun, referente...).
--   3. Le funzioni del ciclo passivo e della banca che non la usano la
--      chiamano in testa (elenco sotto, verificato sul vivo il 09/11/2026).
-- La stessa lacuna per 'dipendente' e 'operatore_cassa' e' preesistente e
-- va trattata a parte (la chiusura cassa usa funzioni vicine).
--
-- NO DATA LOSS: solo funzioni. Tenant: NZ e Zago.
-- Rollback: 20261109_379_responsabile_niente_funzioni_finanza_ROLLBACK.sql
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.responsabile_non_qui()
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF COALESCE(auth.role(), '') = 'authenticated'
     AND COALESCE((SELECT public.get_my_role())::text, '') = 'responsabile' THEN
    RAISE EXCEPTION 'Non disponibile con il profilo responsabile' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.responsabile_non_qui() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.responsabile_non_qui() TO authenticated, service_role;

DO $$
DECLARE
  f text;
  d text;
  n text;
  i int;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.richiedi_profilo_gestionale()',
    'public.apply_statement_enrichment(jsonb,text)',
    'public.log_bank_sync_run(integer,integer,jsonb)',
    'public.reconcile_fiscal_deadline(uuid,uuid)',
    'public.undo_reconcile_fiscal_deadline(uuid)',
    'public.rpc_automatch_riba_distinta(uuid)',
    'public.rpc_backfill_supplier_profiles(integer)',
    'public.rpc_cash_card_provisional_close_backlog()',
    'public.rpc_categorize_from_lines_backlog(boolean)',
    'public.rpc_confirm_riba_distinta(uuid)',
    'public.rpc_confirm_riba_distinta_line(uuid,uuid[])',
    'public.rpc_link_riba_credit_note(uuid,uuid)',
    'public.rpc_refresh_payment_anomalies()',
    'public.rpc_resolve_payment_anomaly(uuid)',
    'public.rpc_riba_provisional_close_backlog()',
    'public.rpc_riba_provisional_undo(uuid)',
    'public.rpc_unlink_riba_credit_note(uuid)'
  ] LOOP
    d := pg_get_functiondef(f::regprocedure);
    IF d ~ 'responsabile_non_qui' THEN CONTINUE; END IF; -- gia' fatto
    i := strpos(d, E'\nBEGIN\n');
    IF i = 0 THEN RAISE EXCEPTION '%: inizio del corpo non trovato', f; END IF;
    n := left(d, i + 6) || E'  PERFORM public.responsabile_non_qui(); -- migration 379\n' || substr(d, i + 7);
    EXECUTE n;
  END LOOP;
END;
$$;

COMMIT;

-- Verifica: SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prokind = 'f' AND pg_get_functiondef(oid) ~ 'migration 379';  -- 17
