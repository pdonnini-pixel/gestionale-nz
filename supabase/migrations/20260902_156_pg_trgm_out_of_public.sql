-- =====================================================================
-- Migrazione 156 — pg_trgm spostata da public a extensions
-- =====================================================================
-- CHIUDE parzialmente l'advisor 0014_extension_in_public: la parte relativa
-- a pg_trgm, l'unica delle tre extension segnalate che PostgreSQL accetti di
-- spostare (vedi in fondo per http e pg_net).
--
-- PERCHE': un'extension nello schema public mette le proprie funzioni e i
-- propri operatori nello stesso namespace delle tabelle applicative, esposto
-- via PostgREST. Non e' un buco di dati come la RLS mancante, ma allarga la
-- superficie e puo' far collidere i nomi. Lo schema `extensions` esiste gia'
-- su tutti e 3 i tenant e ospita pgcrypto, uuid-ossp e pg_stat_statements:
-- pg_trgm va dove stanno le altre.
--
-- ⚠️ IL PUNTO DELICATO — il search_path.
-- Spostare un'extension cambia la risoluzione dei nomi. Il search_path di
-- default del database e' `"$user", public, extensions` (verificato sui 3
-- tenant), quindi le query normali continuano a risolvere `similarity()` e
-- l'operatore `%`. MA le funzioni con un search_path PROPRIO, fissato a
-- `public` o `public, pg_temp`, smetterebbero di vedere pg_trgm. Sono il
-- bridge A-Cube e la riconciliazione:
--   try_match_bank_transaction, acube_cf_sync_inbound_production,
--   acube_sdi_sync_inbound_production, acube_sdi_sync_outbound_production
-- Romperle significherebbe fermare import fatture e riconciliazione bancaria.
--
-- Per questo la PARTE A viene PRIMA dello spostamento e aggiunge `extensions`
-- in CODA al search_path di ogni funzione public che ne dichiara uno. In coda,
-- quindi public mantiene la precedenza e nessun nome viene mascherato:
-- l'aggiunta e' puramente additiva.
--
-- Restano fuori, di proposito, le funzioni con `search_path=""`: e' un
-- hardening deliberato (qualificano ogni oggetto per esteso) e nessuna delle
-- tre usa pg_trgm o http (verificato: update_tickets_aggiornato_il,
-- suppliers_autoslug, _suppliers_slugify).
--
-- VERIFICA FATTA PRIMA DI APPLICARE (dry-run in transazione + ROLLBACK):
--   NZ   → similarity() risolve in `extensions`, operatore `%` funziona,
--          max similarity su suppliers = 0.133, idx_suppliers_name_trgm vivo
--   Made → similarity() in `extensions`, `%` ok, max similarity = 0.050
-- L'indice GIN gin_trgm_ops sopravvive: punta all'operator class per OID,
-- non per nome.
--
-- 🚫 NO DATA LOSS: nessuna riga, tabella o colonna toccata. Solo namespace
--    e search_path.
--
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago (3 project_id).
--
-- --------------------------------------------------------------------
-- NOTA — http e pg_net restano in public, e non e' una dimenticanza.
-- PostgreSQL le rifiuta entrambe:
--     ERROR 0A000: extension "http" does not support SET SCHEMA
--     ERROR 0A000: extension "pg_net" does not support SET SCHEMA
-- Sono dichiarate non rilocabili dal loro control file. L'unica strada
-- sarebbe DROP + CREATE ... SCHEMA extensions, che ricade sotto la REGOLA
-- GRANITICA NO DATA LOSS e richiede conferma esplicita. Per pg_net il
-- guadagno sarebbe comunque nullo: i suoi oggetti (http_request_queue,
-- _http_response) vivono gia' nello schema `net`, non in public — in public
-- c'e' solo la registrazione dell'extension.
-- --------------------------------------------------------------------
-- =====================================================================

-- ---------- PARTE A: extensions in coda al search_path delle funzioni ----------
DO $$
DECLARE
  r   RECORD;
  sp  TEXT;
  cnt INTEGER := 0;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           (SELECT c FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%') AS cfg
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proconfig IS NOT NULL
      AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
      AND NOT (array_to_string(p.proconfig, ',') ILIKE '%extensions%')
    ORDER BY p.proname
  LOOP
    sp := btrim(replace(r.cfg, 'search_path=', ''));
    -- search_path vuoto = hardening deliberato: non si tocca
    CONTINUE WHEN sp = '' OR sp = '""';
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = %s, extensions',
                   r.proname, r.args, sp);
    cnt := cnt + 1;
  END LOOP;
  RAISE NOTICE '156/A — search_path esteso con `extensions` su % funzioni', cnt;
END $$;

-- ---------- PARTE B: spostamento di pg_trgm ----------
DO $$
DECLARE
  schema_attuale TEXT;
BEGIN
  SELECT n.nspname INTO schema_attuale
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';

  IF schema_attuale IS NULL THEN
    RAISE NOTICE '156/B — pg_trgm non installata su questo tenant: niente da fare';
  ELSIF schema_attuale = 'extensions' THEN
    RAISE NOTICE '156/B — pg_trgm gia'' in `extensions`: no-op';
  ELSE
    EXECUTE 'ALTER EXTENSION pg_trgm SET SCHEMA extensions';
    RAISE NOTICE '156/B — pg_trgm spostata da % a extensions', schema_attuale;
  END IF;
END $$;

-- Verifica:
--   SELECT e.extname, n.nspname
--   FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
--   WHERE e.extname = 'pg_trgm';                      -- atteso: extensions
--
--   SET search_path = public, extensions;
--   SELECT count(*) FROM public.suppliers WHERE name % 'ROSSI';   -- non deve errare
--   SELECT max(similarity(name, 'ROSSI')) FROM public.suppliers;  -- non deve errare
