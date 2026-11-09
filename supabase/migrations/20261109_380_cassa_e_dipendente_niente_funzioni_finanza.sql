-- =====================================================================
-- Migrazione 380 — Account di negozio e dipendenti non chiamano le
-- funzioni di banca, fatture e riconciliazione
-- =====================================================================
-- Dalla revisione di sicurezza del 09/11/2026 (PR del profilo responsabile,
-- migration 379). Molte funzioni SECURITY DEFINER del ciclo passivo e della
-- banca sono eseguibili da «authenticated» e controllano solo che l'utente
-- abbia un profilo (richiedi_profilo_gestionale, migration 364) o nemmeno
-- quello. Girano come proprietario, quindi la RLS non le ferma: un account
-- di negozio (operatore_cassa) o un dipendente dell'app, con il proprio
-- token, poteva chiamarle direttamente e forzare o disfare riconciliazioni,
-- confermare distinte, scrivere sui movimenti.
--
-- PERCHE' NON DENTRO richiedi_profilo_gestionale (come la 379 per il
-- responsabile): la conferma della chiusura cassa passa da
--   confirm_cash_closing -> project_cash_closing_to_daily_revenue
--     -> storni_altri_giorni_da_foto (che chiama richiedi_profilo_gestionale)
-- quindi bloccare lì l'operatore di cassa romperebbe la chiusura.
--
-- MISURA (09/11/2026, NZ e Zago identici: 142 funzioni SECURITY DEFINER
-- eseguibili da authenticated, stesso elenco):
--   * RPC chiamate dalla Chiusura cassa (src/pages/ChiusuraCassa.tsx e la
--     Edge Function cash-closing-reopen-request, l'unica che chiama il DB
--     con il token dell'utente): confirm_cash_closing, reopen_cash_closing,
--     delete_cash_closing, request_cash_closing_reopen, get_outlet_day_targets.
--     Catena interna: can_write_cash_closing, project_cash_closing_to_daily_revenue,
--     storni_altri_giorni_da_foto, has_outlet_access. Nessuna è nell'elenco.
--   * RPC di /app e /timbra (AppDipendente.tsx, components/app/*, Timbra.tsx,
--     lib/timbratureCoda.ts, lib/pushNativo.ts): app_dipendente_*,
--     app_registra_push_token, timbratrice_negozi, timbratrice_dati,
--     timbrature_registra e i loro helper. Nessuna è nell'elenco.
--   * I trigger sulle tabelle che cassa e dipendente scrivono (per esempio
--     trg_cash_closing_report_dispatch -> daily_report_dispatch) restano
--     liberi: la guardia non scatta dentro un trigger (pg_trigger_depth > 0).
--     Da trigger una funzione parte solo per effetto di una scrittura che la
--     RLS ha già ammesso.
--   * Cron (nessun JWT) ed Edge Function con la service role: auth.role()
--     non è «authenticated», nessun effetto.
--
-- COSA FA:
--   1. ruoli_operativi_non_qui(): errore 42501 se chi chiama dall'API è un
--      operatore_cassa o un dipendente, fuori da un trigger.
--   2. Salva la definizione attuale delle 52 funzioni in _bkp_380_funzioni.
--   3. In ognuna aggiunge una riga subito dopo il BEGIN del blocco esterno:
--        PERFORM public.ruoli_operativi_non_qui(); -- migration 380
--      Stessa tecnica della 364 (CREATE OR REPLACE con la definizione letta da
--      pg_get_functiondef: proprietario, GRANT, SECURITY DEFINER e
--      search_path restano). Rilanciabile: salta le funzioni già fatte.
--   Per tutti gli altri ruoli nulla cambia.
--
-- ATTENZIONE PER LE MIGRATION SUCCESSIVE: un CREATE OR REPLACE di una di
-- queste funzioni toglie la guardia senza errori. Chi la riscrive tiene la
-- riga, oppure rilancia questa migration dopo la propria.
--
-- NO DATA LOSS: solo funzioni. Tenant: NZ e Zago (Made escluso dal 03/11).
-- Rollback: 20261109_380_cassa_e_dipendente_niente_funzioni_finanza_ROLLBACK.sql
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.ruoli_operativi_non_qui()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF COALESCE(auth.role(), '') = 'authenticated'
     AND pg_trigger_depth() = 0
     AND COALESCE((SELECT public.get_my_role())::text, '') IN ('operatore_cassa', 'dipendente') THEN
    RAISE EXCEPTION 'Non disponibile con questo profilo' USING ERRCODE = '42501';
  END IF;
END;
$$;
-- La chiamano solo le funzioni SECURITY DEFINER (come proprietario).
REVOKE ALL ON FUNCTION public.ruoli_operativi_non_qui() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ruoli_operativi_non_qui() TO service_role;

-- Backup delle definizioni: RLS attiva, nessun GRANT (invisibile all'API).
CREATE TABLE IF NOT EXISTS public._bkp_380_funzioni (
  firma        text PRIMARY KEY,
  definizione  text NOT NULL,
  salvata_il   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public._bkp_380_funzioni ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bkp_380_funzioni FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_nomi text[] := ARRAY[
    -- riconciliazione banca <-> scadenzario
    'reconcile_movement', 'reconcile_movement_group', 'undo_reconcile_movement',
    'try_match_bank_transaction', 'try_match_distinta_bank_transaction',
    'try_match_group_bank_transaction', 'try_match_group_numbers_bank_transaction',
    'run_daily_reconciliation', 'rerun_reconciliation', 'rerun_amount_reconciliation',
    'rerun_bijective_reconciliation', 'rerun_distinta_reconciliation',
    'rerun_group_reconciliation', 'rerun_cash_card_provisional_close',
    'rerun_riba_provisional_close', 'clean_bank_category_conflicts',
    'close_incoming_movements', 'close_non_supplier_movements', 'close_utility_movements',
    'match_customer_transfers_with_closings',
    -- banca: estratti, sync
    'apply_statement_enrichment', 'log_bank_sync_run', 'acube_ob_sync_all_production',
    -- scadenze fiscali
    'reconcile_fiscal_deadline', 'undo_reconcile_fiscal_deadline', 'close_paid_fiscal_deadlines',
    -- ciclo passivo: RiBa, carte, note di credito, anomalie, profili fornitore
    'rpc_automatch_riba_distinta', 'rpc_confirm_riba_distinta', 'rpc_confirm_riba_distinta_line',
    'rpc_link_riba_credit_note', 'rpc_unlink_riba_credit_note', 'rpc_riba_provisional_undo',
    'rpc_riba_provisional_close_backlog', 'fn_riba_provisional_close',
    'rpc_cash_card_provisional_close_backlog', 'fn_cash_card_provisional_close',
    'rpc_refresh_payment_anomalies', 'rpc_resolve_payment_anomaly',
    'rpc_backfill_supplier_profiles', 'fn_supplier_profile_from_invoice',
    'rpc_categorize_from_lines_backlog', 'align_payable_categories',
    'apply_credit_note_links', 'rpc_merge_manual_notula', 'notify_invoices_without_xml',
    -- budget, controlli, report serali, organico
    'refresh_budget_consuntivo', 'closing_checks_dispatch', 'closing_checks_tick',
    'daily_cash_report_tick', 'daily_report_dispatch', 'check_pixel_and_alert',
    'organico_imposta_referente'
  ];
  v_nome text;
  f      record;
  v_def  text;
  v_at   int;
  v_len  int;
  n      int := 0;
BEGIN
  FOREACH v_nome IN ARRAY v_nomi LOOP
    SELECT p.oid, p.oid::regprocedure::text AS firma, p.prosecdef, l.lanname
      INTO f
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_nome AND p.prokind = 'f';
    IF NOT FOUND THEN
      RAISE EXCEPTION '380: funzione % non trovata', v_nome;
    END IF;
    IF NOT f.prosecdef OR f.lanname <> 'plpgsql' THEN
      RAISE EXCEPTION '380: % non è plpgsql SECURITY DEFINER', f.firma;
    END IF;

    v_def := pg_get_functiondef(f.oid);
    CONTINUE WHEN v_def ~ 'ruoli_operativi_non_qui';

    -- Primo BEGIN su una riga da solo dopo l'inizio del corpo.
    v_at := position('$function$' IN v_def);
    IF v_at = 0 THEN
      RAISE EXCEPTION '380: % senza corpo $function$', f.firma;
    END IF;
    v_len := regexp_instr(substring(v_def FROM v_at), E'\\n[ \\t]*BEGIN[ \\t]*\\n', 1, 1, 1);
    IF v_len = 0 THEN
      RAISE EXCEPTION '380: % senza BEGIN su riga propria', f.firma;
    END IF;
    v_len := v_at + v_len - 1;   -- primo carattere dopo il «\n» che chiude BEGIN

    INSERT INTO public._bkp_380_funzioni (firma, definizione)
    VALUES (f.firma, v_def)
    ON CONFLICT (firma) DO UPDATE SET definizione = EXCLUDED.definizione, salvata_il = now();

    EXECUTE left(v_def, v_len - 1)
         || E'  PERFORM public.ruoli_operativi_non_qui(); -- migration 380\n'
         || substring(v_def FROM v_len);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '380: guardia inserita in % funzioni', n;
END;
$$;

COMMIT;

-- Verifica (attese 52 su NZ e su Zago):
--   SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
--      AND prokind = 'f' AND pg_get_functiondef(oid) ~ 'PERFORM public.ruoli_operativi_non_qui\(\); -- migration 380';
