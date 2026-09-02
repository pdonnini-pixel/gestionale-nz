-- =====================================================================
-- Migrazione 154 — EXECUTE revocato ad anon sulle RPC SECURITY DEFINER
-- =====================================================================
-- CHIUDE l'advisor 0028_anon_security_definer_function_executable sui 3 tenant.
--
-- COSA SUCCEDEVA: le 10 RPC del flusso RiBa create ad agosto 2026 (distinte,
-- note di credito, chiusura provvisoria) sono nate SECURITY DEFINER con il
-- GRANT EXECUTE di default a PUBLIC, che in Supabase include `anon`. Con la
-- sola anon key — pubblica, sta nel bundle JS — chiunque poteva chiamarle
-- su /rest/v1/rpc/<nome> SENZA autenticarsi. Non sono di sola lettura:
-- rpc_confirm_riba_distinta, rpc_riba_provisional_undo,
-- rpc_link_riba_credit_note e rerun_riba_provisional_close SCRIVONO su
-- payables. E' lo stesso buco gia' chiuso dalla migration 116 per le RPC di
-- proposte di pagamento e anomalie: qui le funzioni nuove non erano coperte.
--
-- Funzioni interessate (identiche sui 3 tenant, verificate al 2026-09-02):
--   fn_payable_is_riba, fn_riba_provisional_close, rerun_riba_provisional_close,
--   rpc_automatch_riba_distinta, rpc_confirm_riba_distinta,
--   rpc_confirm_riba_distinta_line, rpc_link_riba_credit_note,
--   rpc_riba_provisional_close_backlog, rpc_riba_provisional_undo,
--   rpc_unlink_riba_credit_note
--
-- FIX: REVOKE ALL da PUBLIC e anon, GRANT EXECUTE ad authenticated e
-- service_role. Nessuna regressione per l'app: le chiamate partono tutte da
-- pagine dietro ProtectedRoute, quindi con sessione loggata = ruolo
-- `authenticated` (verificato: RibaCreditNotesModal.tsx, RibaDistintaModal.tsx,
-- ScadenzarioSmart.tsx). Le Edge Function usano service_role.
--
-- Sweep DINAMICO su tutte le funzioni SECURITY DEFINER non-trigger ancora
-- eseguibili da anon, cosi' copre anche eventuali RPC aggiunte in futuro e
-- resta parity-safe. Le trigger function erano gia' state blindate dalla 116
-- (PART A) e restano escluse qui.
--
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago (3 project_id).
-- =====================================================================

DO $$
DECLARE
  r   RECORD;
  cnt INTEGER := 0;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
    ORDER BY p.proname
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', r.proname, r.args);
    cnt := cnt + 1;
    RAISE NOTICE 'anon revocato, authenticated preservato: public.%(%)', r.proname, r.args;
  END LOOP;
  RAISE NOTICE '154 — RPC SECURITY DEFINER blindate contro anon: %', cnt;
END $$;

-- Verifica (deve restituire 0 righe: nessuna RPC definer eseguibile da anon):
--   SELECT p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.prosecdef
--     AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)
--     AND has_function_privilege('anon', p.oid, 'EXECUTE');
