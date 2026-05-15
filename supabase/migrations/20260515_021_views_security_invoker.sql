-- Migrazione 021 — security cleanup viste
-- Tutte le viste public.v_* passano da SECURITY DEFINER (default storico)
-- a SECURITY INVOKER. Effetto: i permessi di RBAC contano anche quando
-- si interroga via vista. Niente cambia per i ruoli che hanno già SELECT
-- sulle tabelle sottostanti (CEO/super_advisor/contabile attualmente).

DO $$
DECLARE
  v RECORD;
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
  RAISE NOTICE 'Convertite % viste a security_invoker=on', cnt;
END $$;
