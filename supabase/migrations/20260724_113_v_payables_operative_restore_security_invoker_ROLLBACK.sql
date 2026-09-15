-- ROLLBACK migrazione 113 — SOLO EMERGENZA.
-- ⚠️ Riporta le viste public.v_* a SECURITY DEFINER (security_invoker=off):
--    REINTRODUCE l'advisor 0010_security_definer_view. Usare solo se il passaggio
--    a security_invoker rompe un accesso legittimo (non atteso: le tabelle
--    sottostanti hanno già policy SELECT per authenticated).
-- ⚠️ REGOLA #0 — se applicato, applicarlo su NZ + Made + Zago.

DO $$
DECLARE
  v RECORD;
BEGIN
  FOR v IN
    SELECT viewname FROM pg_views
    WHERE schemaname = 'public' AND viewname LIKE 'v\_%' ESCAPE '\'
    ORDER BY viewname
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = off)', v.viewname);
  END LOOP;
END $$;
