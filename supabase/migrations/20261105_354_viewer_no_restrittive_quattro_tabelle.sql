-- =====================================================================
-- Migrazione 354 — Le regole «viewer_no_*» di quattro tabelle tornano a restringere
-- =====================================================================
-- COSA NON ANDAVA: su invoice_cost_flags, invoice_cost_overrides (migr. 291
-- e 306), outlet_travel_places (279) e utility_supply_points (274) le
-- policy viewer_no_insert / viewer_no_update / viewer_no_delete sono state
-- create senza AS RESTRICTIVE e senza TO authenticated. Una policy
-- permissiva si somma in OR alle altre, quindi invece di togliere la
-- scrittura al viewer la DAVA a chiunque non fosse viewer, compreso un
-- visitatore non autenticato (anon, con la sola chiave pubblica del sito:
-- ha i GRANT di scrittura e per lui get_my_role() e' NULL). In pratica:
--   - chiunque poteva inserire righe con qualsiasi company_id;
--   - chiunque poteva cancellare o modificare le righe con un DELETE/UPDATE
--     senza filtri (le policy di DELETE/UPDATE non guardavano l'azienda);
--   - il viewer, viceversa, poteva scrivere tramite company_isolation.
-- Verifica del 05/11/2026: nessuna riga estranea (NZ 6 + 11 + 27 + 11
-- righe, tutte di aziende vere; Zago 0 righe). Il frontend legge solo
-- invoice_cost_overrides (Prima Nota); le scritture le fanno funzioni
-- SECURITY DEFINER (fn_segna_fatture_non_costo, fn_negozio_per_fattura,
-- fn_riparto_automatico...) che ignorano la RLS.
--
-- COSA FA (nessun DROP, nessun dato toccato):
--   1. ALTER POLICY sulle tre viewer_no_* esistenti: TO authenticated e
--      condizione limitata alla propria azienda e ai non viewer. Restano
--      permissive (ALTER POLICY non cambia il tipo), ma non danno piu'
--      niente oltre a company_isolation.
--   2. Tre policy RESTRITTIVE nuove viewer_sola_lettura_{insert,update,
--      delete}: il viewer non scrive nemmeno tramite company_isolation.
-- Rilanciabile: ALTER POLICY e' idempotente, le CREATE si saltano se c'e'
-- gia' la policy.
--
-- PARITA' TENANT: dal 03/11/2026 NZ + Zago (niente Made).
-- =====================================================================

DO $$
DECLARE
  t text;
  azienda text := 'company_id = (SELECT public.get_my_company_id())';
  non_viewer text := 'COALESCE((SELECT public.get_my_role())::text, '''') <> ''viewer''';
BEGIN
  FOREACH t IN ARRAY ARRAY['invoice_cost_flags', 'invoice_cost_overrides',
                           'outlet_travel_places', 'utility_supply_points'] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE NOTICE 'tabella % assente, saltata', t;
      CONTINUE;
    END IF;

    -- 1. le permissive esistenti smettono di allargare
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'viewer_no_insert') THEN
      EXECUTE format('ALTER POLICY viewer_no_insert ON public.%I TO authenticated WITH CHECK (%s AND %s)', t, azienda, non_viewer);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'viewer_no_update') THEN
      EXECUTE format('ALTER POLICY viewer_no_update ON public.%I TO authenticated USING (%s AND %s) WITH CHECK (%s AND %s)', t, azienda, non_viewer, azienda, non_viewer);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'viewer_no_delete') THEN
      EXECUTE format('ALTER POLICY viewer_no_delete ON public.%I TO authenticated USING (%s AND %s)', t, azienda, non_viewer);
    END IF;

    -- 2. il viewer resta in sola lettura anche tramite company_isolation
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'viewer_sola_lettura_insert') THEN
      EXECUTE format('CREATE POLICY viewer_sola_lettura_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)', t, non_viewer);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'viewer_sola_lettura_update') THEN
      EXECUTE format('CREATE POLICY viewer_sola_lettura_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', t, non_viewer, non_viewer);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'viewer_sola_lettura_delete') THEN
      EXECUTE format('CREATE POLICY viewer_sola_lettura_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (%s)', t, non_viewer);
    END IF;
  END LOOP;
END $$;

-- Verifica: nessuna policy permissiva di scrittura senza controllo
-- dell'azienda su queste quattro tabelle, e 3 restrittive per tabella.
--   SELECT tablename, policyname, permissive, cmd, roles, qual, with_check
--     FROM pg_policies WHERE schemaname = 'public'
--      AND tablename IN ('invoice_cost_flags','invoice_cost_overrides',
--                        'outlet_travel_places','utility_supply_points')
--    ORDER BY 1, 2;
