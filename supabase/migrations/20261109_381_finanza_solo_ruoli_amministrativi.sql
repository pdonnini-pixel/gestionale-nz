-- =====================================================================
-- Migrazione 381 — Le 52 funzioni di banca, fatture e riconciliazione
-- ammettono solo i ruoli amministrativi
-- =====================================================================
-- Debito registrato dal revisore di sicurezza sulla 380 (PR #793): la
-- guardia ruoli_operativi_non_qui() era a lista nera (fermava solo
-- operatore_cassa e dipendente). viewer (sola lettura), budget_approver,
-- un utente senza profilo o un ruolo aggiunto domani passavano ancora,
-- con il solo controllo del profilo della 364 (che non c'è su tutte).
--
-- COSA FA:
--   1. ruoli_operativi_non_qui() diventa una lista bianca. Chi chiama
--      dall'API (JWT anon o authenticated, fuori da un trigger) passa solo
--      se il suo profilo ha un ruolo amministrativo:
--        super_advisor, contabile, ceo, cfo, coo
--      (stessa lista di RUOLI_AMMINISTRATIVI in
--      supabase/functions/_shared/verificaProfilo.ts). Tutti gli altri,
--      compresi viewer, budget_approver, responsabile, operatore_cassa,
--      dipendente e chi non ha profilo, ricevono 42501.
--      Il nome resta quello della 380: le 52 funzioni la chiamano già, così
--      non si riscrive nessuna di loro (meno rischio, un solo punto).
--   2. daily_report_outlets(uuid) e daily_report_is_complete(uuid,date)
--      (nota bassa del revisore): SECURITY DEFINER eseguibili anche da anon
--      e authenticated senza controllo di azienda. Le chiamano solo
--      funzioni SECURITY DEFINER dello stesso proprietario
--      (fn_cash_closing_report_dispatch, daily_cash_report_tick) e la Edge
--      Function daily-cash-report-send con la service role: si tolgono
--      anon e authenticated, resta service_role.
--
-- MISURA SUL VIVO (09/11/2026, NZ e Zago identici, 52 guardie per tenant):
--   * Frontend (src/): le RPC delle 52 stanno in pagine che il menu mostra
--     solo ai ruoli amministrativi (Banche/TesoreriaManuale, Import Hub,
--     Estratti, Scadenzario, Scadenze fiscali, RiBa, Fatturazione,
--     Dipendenti/TurniNegozi per il referente). Il viewer vede Banche,
--     Scadenzario e Fatturazione, ma è sola lettura per progetto (policy
--     RESTRICTIVE della 240): le uniche due chiamate automatiche che gli
--     arrivano sono align_payable_categories (Scadenzario) e
--     rpc_refresh_payment_anomalies (riquadro anomalie), che ricalcolano e
--     scrivono; l'errore è già ignorato dal codice e la pagina legge i dati
--     com'erano. refresh_budget_consuntivo non è più invocata dalla UI.
--   * budget_approver come ruolo di profilo vede solo Segnalazioni: nessuna
--     delle 52. Oggi nessun utente ha quel ruolo di profilo (NZ: 2
--     contabile, 2 super_advisor, 2 viewer, 8 operatore_cassa, 1
--     dipendente, 1 responsabile; Zago: 2 contabile, 2 super_advisor, 2
--     viewer).
--   * Edge Function: run_daily_reconciliation (acube-ob-tx-sync) e
--     daily_report_outlets (daily-cash-report-send) con la service role:
--     auth.role() = 'service_role', passano.
--   * Cron: acube_ob_sync_all_production, run_daily_reconciliation,
--     closing_checks_tick, daily_cash_report_tick,
--     notify_invoices_without_xml, match_cash_closings_with_bank girano
--     senza JWT: auth.role() è NULL, passano.
--   * Trigger: trg_cash_closing_report_dispatch (chiusura cassa ->
--     daily_report_dispatch), trg_auto_reconcile_on_bank_tx (try_match_*),
--     trg_sync_acube_sdi_passive (fn_supplier_profile_from_invoice):
--     pg_trigger_depth() > 0, passano. La chiusura cassa resta invariata.
--   * Chiamate fra le 52 (run_daily_reconciliation -> rerun_*, ecc.): la
--     guardia si ripete con lo stesso esito, nessun effetto nuovo.
--
-- NO DATA LOSS: solo una funzione e due REVOKE. Tenant: NZ e Zago (Made
-- escluso dal 03/11).
-- Rollback: 20261109_381_finanza_solo_ruoli_amministrativi_ROLLBACK.sql
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.ruoli_operativi_non_qui()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Cron (nessun JWT) e service role passano; dentro un trigger la scrittura
  -- che lo ha fatto partire è già stata ammessa dalla RLS.
  IF COALESCE(auth.role(), '') NOT IN ('', 'service_role')
     AND pg_trigger_depth() = 0
     AND COALESCE((SELECT public.get_my_role())::text, '')
         NOT IN ('super_advisor', 'contabile', 'ceo', 'cfo', 'coo') THEN
    RAISE EXCEPTION 'Non disponibile con questo profilo' USING ERRCODE = '42501';
  END IF;
END;
$$;
COMMENT ON FUNCTION public.ruoli_operativi_non_qui() IS
  'Guardia delle funzioni di banca, fatture e riconciliazione (migration 380, lista bianca dalla 381): '
  'dall''API passano solo super_advisor, contabile, ceo, cfo, coo. Cron, service role e trigger esenti. '
  'Chi riscrive una funzione che la chiama tiene la riga PERFORM (controllo CI tools/check-guardia-finanza.mjs).';
REVOKE ALL ON FUNCTION public.ruoli_operativi_non_qui() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ruoli_operativi_non_qui() TO service_role;

REVOKE ALL ON FUNCTION public.daily_report_outlets(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.daily_report_is_complete(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daily_report_outlets(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.daily_report_is_complete(uuid, date) TO service_role;

COMMIT;

-- Verifica (NZ e Zago):
--   SELECT pg_get_functiondef('public.ruoli_operativi_non_qui()'::regprocedure) ~ 'super_advisor';  -- true
--   SELECT has_function_privilege('authenticated', 'public.daily_report_outlets(uuid)', 'execute'),
--          has_function_privilege('anon', 'public.daily_report_is_complete(uuid,date)', 'execute');  -- false, false
--   SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prokind = 'f'
--      AND pg_get_functiondef(oid) ~ 'PERFORM public.ruoli_operativi_non_qui\(\); -- migration 380';  -- 52
