-- =====================================================================
-- Migrazione 122 — Lockdown EXECUTE su try_match_amount_bank_transaction
-- =====================================================================
-- Completa la migr. 116 (restrizione EXECUTE su funzioni SECURITY DEFINER).
-- CHIUDE l'advisor 0029 (authenticated puo' eseguire una RPC SECURITY DEFINER)
-- per public.try_match_amount_bank_transaction(uuid), rimasta fuori dalla 116.
--
-- SICUREZZA DELLA MODIFICA (verificata sul DB vivo, 2026-07-28):
--   • È un matcher INTERNO: non è mai chiamato via /rest/v1/rpc dal frontend
--     (nel codice ci sono solo commenti, nessuna .rpc('try_match_amount...')).
--   • Gli UNICI chiamanti nel DB sono `trg_auto_reconcile_bank_transaction`
--     (trigger) e `rerun_amount_reconciliation` (cron) — entrambi SECURITY
--     DEFINER: le chiamate interne girano come owner e NON richiedono il
--     privilegio EXECUTE del ruolo chiamante. Revocare EXECUTE da authenticated
--     è quindi SICURO (nessuna regressione per l'app né per il cron).
--   • Grant attuali: {postgres, authenticated, service_role}. Si revoca solo
--     authenticated; owner e service_role (backend/edge) restano.
--
-- Additiva/reversibile (file _ROLLBACK ripristina il grant ad authenticated).
-- ⚠️ REGOLA #0 — NZ + Made + Zago.
-- =====================================================================

REVOKE ALL ON FUNCTION public.try_match_amount_bank_transaction(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_match_amount_bank_transaction(uuid) TO service_role;
