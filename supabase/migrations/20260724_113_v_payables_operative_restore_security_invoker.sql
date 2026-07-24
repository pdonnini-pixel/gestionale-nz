-- =====================================================================
-- Migrazione 113 — Ripristino SECURITY INVOKER sulle viste public.v_*
-- =====================================================================
-- CHIUDE l'advisor 0010_security_definer_view su public.v_payables_operative.
--
-- CAUSA della regressione: la migration 069 (20260615) aveva già impostato
-- security_invoker=on su v_payables_operative. La migration 106 (20260723,
-- doppioni is_placeholder) ha però fatto un  CREATE OR REPLACE VIEW
-- v_payables_operative  SENZA ri-dichiarare l'opzione: in PostgreSQL il
-- CREATE OR REPLACE VIEW rigenera la vista con i reloptions di default, quindi
-- security_invoker è tornato = off (comportamento SECURITY DEFINER). L'advisor
-- ha ricominciato a segnalarla.
--
-- FIX: ri-applichiamo security_invoker=on a TUTTE le viste public.v_* (sweep
-- idempotente, stesso pattern della migration 021). Così ri-blindiamo non solo
-- v_payables_operative ma qualsiasi altra vista che avesse perso l'opzione per
-- una CREATE OR REPLACE successiva. Impostare on quando è già on è un no-op.
--
-- Effetto: la vista esegue con i permessi/RLS dell'utente che interroga (non
-- del creatore). Tutte le tabelle sottostanti (payables, outlets, suppliers,
-- cost_categories, payable_actions, user_profiles) hanno RLS + policy SELECT
-- per authenticated filtrata su company_id: l'utente vede esattamente i dati
-- della propria azienda, come prima. Non distruttivo, nessun dato toccato.
--
-- ⚠️ REGOLA #0 — applicare a mano su NZ + Made + Zago (3 project_id).
--
-- ⚠️ NOTA PER IL FUTURO: qualsiasi  CREATE OR REPLACE VIEW  su una vista v_*
--    DEVE includere  WITH (security_invoker = on)  nella stessa istruzione,
--    altrimenti l'opzione si perde di nuovo e l'advisor torna a segnalare.
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
  RAISE NOTICE 'security_invoker=on ri-applicato a % viste public.v_*', cnt;
END $$;

-- Verifica (deve restituire 0 righe: nessuna vista v_* senza security_invoker):
--   SELECT c.relname
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE 'v\_%'
--     AND NOT COALESCE((
--       SELECT (option_value)::boolean
--       FROM pg_options_to_table(c.reloptions) AS o(option_name, option_value)
--       WHERE o.option_name = 'security_invoker'
--     ), false);
