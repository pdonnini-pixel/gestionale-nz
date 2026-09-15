-- ROLLBACK migrazione 116 — SOLO EMERGENZA.
-- Ripristina EXECUTE a PUBLIC sulle funzioni toccate → REINTRODUCE gli advisor
-- 0028/0029. Da usare solo se un flusso legittimo avesse davvero bisogno che
-- anon/PUBLIC eseguisse una di queste funzioni (caso non previsto).
-- ⚠️ REGOLA #0 — se applicato, applicarlo su NZ + Made + Zago.

-- PART A — ripristina EXECUTE a PUBLIC sulle trigger/event-trigger function
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prorettype IN ('trigger'::regtype, 'event_trigger'::regtype)
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO PUBLIC', r.proname, r.args);
  END LOOP;
END $$;

-- PART B — ripristina EXECUTE a PUBLIC sulle 7 RPC
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY['acube_ob_sync_all_production','rpc_apply_all_payment_proposals',
        'rpc_apply_payment_proposal','rpc_discard_payment_proposal','rpc_merge_manual_notula',
        'rpc_refresh_payment_anomalies','rpc_resolve_payment_anomaly'])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO PUBLIC', r.proname, r.args);
  END LOOP;
END $$;
