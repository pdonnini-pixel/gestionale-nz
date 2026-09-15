-- =====================================================================
-- Migrazione 116 — Restrizione EXECUTE su funzioni SECURITY DEFINER
-- =====================================================================
-- CHIUDE:
--   * 0028_anon_security_definer_function_executable  (anon puo' eseguire RPC
--     SECURITY DEFINER — buco reale: anon = NON autenticato)
--   * 0029_..._authenticated_...  per le sole funzioni TRIGGER (che non vanno
--     mai chiamate come RPC).
--
-- Due interventi, entrambi non distruttivi e reversibili:
--
-- PART A — Funzioni TRIGGER / EVENT TRIGGER: REVOKE EXECUTE da PUBLIC, anon,
--   authenticated. In PostgreSQL una funzione trigger viene invocata dal
--   meccanismo di trigger e NON richiede il privilegio EXECUTE sul ruolo che
--   scatena l'evento: revocarlo e' quindi SICURO e impedisce che vengano
--   chiamate direttamente via /rest/v1/rpc. Sweep dinamico su tutte le trigger
--   function di public (parity-safe: ogni tenant blinda le proprie).
--
-- PART B — RPC SECURITY DEFINER esposte ad anon (lista esplicita, non-trigger):
--   REVOKE da PUBLIC, anon  +  GRANT ad authenticated, service_role.
--   Cosi' anon (non autenticato) perde l'accesso, mentre l'app (authenticated)
--   e il backend (service_role/edge) continuano a funzionare IDENTICI: nessuna
--   regressione per gli utenti loggati. Sono le RPC di proposte di pagamento,
--   anomalie, merge notula e sync OB — tutte azioni da utente autenticato.
--
-- ⚠️ NON tocca le altre funzioni di 0029 (reconcile_movement, onboard_tenant,
--    get_my_company_id, ecc.): sono RPC/helper legittimamente chiamati da
--    authenticated (anche dentro le policy RLS). Revocarle romperebbe l'app:
--    per un'app Supabase quel warning e' atteso/by-design.
--
-- ⚠️ REGOLA #0 — applicare a mano su NZ + Made + Zago (3 project_id).
-- =====================================================================

-- ---------- PART A: trigger / event trigger function ----------
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
      AND p.prorettype IN ('trigger'::regtype, 'event_trigger'::regtype)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
                   r.proname, r.args);
    cnt := cnt + 1;
  END LOOP;
  RAISE NOTICE 'PART A — EXECUTE revocato su % trigger/event-trigger function', cnt;
END $$;

-- ---------- PART B: RPC SECURITY DEFINER esposte ad anon ----------
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
      AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)
      AND p.proname = ANY (ARRAY[
        'acube_ob_sync_all_production',
        'rpc_apply_all_payment_proposals',
        'rpc_apply_payment_proposal',
        'rpc_discard_payment_proposal',
        'rpc_merge_manual_notula',
        'rpc_refresh_payment_anomalies',
        'rpc_resolve_payment_anomaly'
      ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', r.proname, r.args);
    cnt := cnt + 1;
    RAISE NOTICE 'PART B — anon revocato, authenticated preservato: public.%(%)', r.proname, r.args;
  END LOOP;
  RAISE NOTICE 'PART B — RPC blindate contro anon: %', cnt;
END $$;

-- Verifica PART B (deve restituire 0 righe: nessuna delle 7 eseguibile da anon):
--   SELECT p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname = ANY (ARRAY['acube_ob_sync_all_production','rpc_apply_all_payment_proposals',
--       'rpc_apply_payment_proposal','rpc_discard_payment_proposal','rpc_merge_manual_notula',
--       'rpc_refresh_payment_anomalies','rpc_resolve_payment_anomaly'])
--     AND has_function_privilege('anon', p.oid, 'EXECUTE');
