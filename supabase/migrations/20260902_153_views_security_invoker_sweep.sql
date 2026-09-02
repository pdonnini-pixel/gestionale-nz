-- =====================================================================
-- Migrazione 153 — security_invoker ri-applicato alle viste public.v_*
-- =====================================================================
-- CHIUDE (di nuovo) l'advisor 0010_security_definer_view su
-- public.v_payables_operative, sui 3 tenant.
--
-- STORIA DELLA REGRESSIONE — e' la terza volta:
--   069 (2026-06-15) mette security_invoker=on
--   106 (2026-07-23) fa CREATE OR REPLACE VIEW senza l'opzione -> persa
--   113 (2026-07-24) la ri-applica con lo sweep
--   143/144 (2026-08-06) rifanno CREATE OR REPLACE VIEW senza l'opzione -> persa
--   153 (questa)     la ri-applica
-- In PostgreSQL il CREATE OR REPLACE VIEW rigenera i reloptions ai default,
-- quindi l'opzione va RIPETUTA in ogni istruzione che ricrea la vista.
-- Per non ricascarci una quarta volta, il controllo e' ora automatico in CI:
-- `tools/check-view-security-invoker.mjs` fa fallire la PR se una migration
-- ricrea una vista public.v_* senza  WITH (security_invoker = on).
--
-- PERCHE' CONTA: senza security_invoker la vista gira con i permessi del
-- creatore e IGNORA la RLS delle tabelle sottostanti. v_payables_operative
-- espone supplier_iban, supplier_vat e tutti gli importi: un utente
-- autenticato di un'altra azienda avrebbe visto i dati di tutte. E' la
-- seconda meta' della segnalazione Supabase "dati sensibili accessibili".
--
-- VERIFICA FATTA PRIMA DI APPLICARE (dry-run in transazione + ROLLBACK,
-- impersonando un utente `authenticated` reale su ogni tenant):
--   NZ   1418 righe prima -> 1418 dopo   (1 sola company visibile)
--   Made    4 righe prima ->    4 dopo
--   Zago    0 righe prima ->    0 dopo   (tenant senza payables)
-- Nessuna riga persa: le policy SELECT di payables, outlets, suppliers,
-- cost_categories, payable_actions, user_profiles ed electronic_invoices
-- filtrano gia' per company_id, quindi l'utente vede esattamente cio' che
-- vedeva prima — ma solo della propria azienda.
--
-- Sweep su tutte le viste public.v_*: idempotente (metterlo quando e' gia'
-- on e' un no-op) e parity-safe.
--
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago (3 project_id).
-- =====================================================================

DO $$
DECLARE
  v   RECORD;
  cnt INTEGER := 0;
BEGIN
  FOR v IN
    SELECT viewname
    FROM pg_views
    WHERE schemaname = 'public'
      AND viewname LIKE 'v\_%' ESCAPE '\'
    ORDER BY viewname
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v.viewname);
    cnt := cnt + 1;
  END LOOP;
  RAISE NOTICE '153 — security_invoker=on ri-applicato a % viste public.v_*', cnt;
END $$;

-- Verifica (deve restituire 0 righe):
--   SELECT c.relname
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE 'v\_%' ESCAPE '\'
--     AND NOT COALESCE((
--       SELECT (option_value)::boolean
--       FROM pg_options_to_table(c.reloptions) AS o(option_name, option_value)
--       WHERE o.option_name = 'security_invoker'
--     ), false);
