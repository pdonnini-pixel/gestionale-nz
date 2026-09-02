-- =====================================================================
-- ROLLBACK Migrazione 154 — restituisce ad anon l'EXECUTE sulle RPC RiBa
-- =====================================================================
-- ⚠️ Sconsigliato: riapre RPC che scrivono su payables a chiamanti NON
--    autenticati. Da usare solo se si scopre un chiamante legittimo che
--    lavora con la sola anon key; in quel caso la strada giusta e' farlo
--    autenticare, non ripristinare il grant.
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
      AND p.proname = ANY (ARRAY[
        'fn_payable_is_riba',
        'fn_riba_provisional_close',
        'rerun_riba_provisional_close',
        'rpc_automatch_riba_distinta',
        'rpc_confirm_riba_distinta',
        'rpc_confirm_riba_distinta_line',
        'rpc_link_riba_credit_note',
        'rpc_riba_provisional_close_backlog',
        'rpc_riba_provisional_undo',
        'rpc_unlink_riba_credit_note'
      ])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon', r.proname, r.args);
    cnt := cnt + 1;
  END LOOP;
  RAISE NOTICE 'ROLLBACK 154 — anon ripristinato su % funzioni', cnt;
END $$;
