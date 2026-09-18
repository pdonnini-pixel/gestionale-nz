-- 20260918_241_rls_enable_backup_tables_nuove.sql
--
-- Stessa falla chiusa il 02/09 con la migration 152, riaperta dai backup creati
-- durante gli interventi sul ciclo passivo di settembre: tabelle nate da
-- CREATE TABLE ... AS SELECT nello schema public, senza row level security e
-- con i grant di default a anon e authenticated. PostgREST le espone su
-- /rest/v1/<tabella> e la anon key sta nel bundle JS del sito: chiunque poteva
-- leggerle e scriverle. Contengono copie di payables, bank_transactions e log
-- di riconciliazione, quindi IBAN, P.IVA e importi.
--
-- Al 18/09: 11 tabelle su NZ, nessuna su Made e Zago (lo script e' dinamico,
-- sugli altri due tenant non fa nulla e resta valido per il futuro).
--
-- Fix identico alla 152: ENABLE ROW LEVEL SECURITY senza policy. Una tabella
-- con RLS attivo e zero policy e' chiusa per tutti i ruoli non-bypass;
-- postgres e service_role hanno BYPASSRLS, quindi Edge Function e manutenzione
-- continuano a leggere i backup. Nessuna riga toccata, nessuna colonna
-- modificata. Il codice applicativo non interroga queste tabelle (compaiono
-- solo in src/types/database.ts, che e' generato).
--
-- Rollback: 20260918_241_rls_enable_backup_tables_nuove_ROLLBACK.sql

BEGIN;

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname AS tabella
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tabella);
    RAISE NOTICE 'RLS attivata su %', t.tabella;
  END LOOP;
END $$;

COMMIT;

-- ── VERIFICA (attesa: 0 righe su tutti e 3 i tenant) ──────────────────────
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;
