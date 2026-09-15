-- =====================================================================
-- ROLLBACK Migrazione 153 — riporta le viste public.v_* a SECURITY DEFINER
-- =====================================================================
-- ⚠️ Sconsigliato: riapre il buco di isolamento tra aziende (una vista
--    definer ignora la RLS delle tabelle sottostanti) e riporta l'advisor
--    0010 in stato ERROR. Da usare solo se una vista smette di restituire
--    righe e serve tempo per sistemare le policy sottostanti.
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
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = off)', v.viewname);
    cnt := cnt + 1;
  END LOOP;
  RAISE NOTICE 'ROLLBACK 153 — security_invoker=off su % viste', cnt;
END $$;
