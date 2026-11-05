-- ROLLBACK della migrazione 354. ATTENZIONE: riporta le viewer_no_* alla
-- forma sbagliata di prima (permissive, TO public, senza azienda), che lascia
-- scrivere e cancellare anche chi non e' autenticato. Usarlo solo se la 354
-- blocca una scrittura legittima, e per il tempo di correggerla.
DO $$
DECLARE
  t text;
  non_viewer text := 'COALESCE((public.get_my_role())::text, '''') <> ''viewer''';
BEGIN
  FOREACH t IN ARRAY ARRAY['invoice_cost_flags', 'invoice_cost_overrides',
                           'outlet_travel_places', 'utility_supply_points'] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS viewer_sola_lettura_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS viewer_sola_lettura_update ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS viewer_sola_lettura_delete ON public.%I', t);
    EXECUTE format('ALTER POLICY viewer_no_insert ON public.%I TO public WITH CHECK (%s)', t, non_viewer);
    EXECUTE format('ALTER POLICY viewer_no_update ON public.%I TO public USING (%s) WITH CHECK (%s)', t, non_viewer, non_viewer);
    EXECUTE format('ALTER POLICY viewer_no_delete ON public.%I TO public USING (%s)', t, non_viewer);
  END LOOP;
END $$;
