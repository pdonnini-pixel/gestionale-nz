-- =====================================================================
-- Migrazione 152 — RLS abilitato su tutte le tabelle public che ne erano prive
-- =====================================================================
-- CHIUDE l'advisor 0013_rls_disabled_in_public (livello ERROR, segnalato via
-- mail da Supabase il 2026-08-31 come "Publicly accessible table" +
-- "Publicly readable sensitive data").
--
-- COSA SUCCEDEVA: alcune tabelle di backup create al volo durante gli
-- interventi sul ciclo passivo (CREATE TABLE ... AS SELECT) nascono SENZA
-- row level security. Vivendo nello schema `public`, PostgREST le espone su
-- /rest/v1/<tabella>: chiunque conoscesse l'URL del progetto e la anon key
-- (che e' pubblica, sta nel bundle JS) poteva leggerle. Contengono copie di
-- payables, bank_transactions e log di riconciliazione, quindi anche IBAN,
-- P.IVA fornitori e importi: sono gli stessi dati "sensibili" citati nella
-- segnalazione.
--
-- Tabelle interessate al 2026-09-02:
--   NZ   (10): _bkp_reconlog_stale_20260803, payables_bkp_manualclose_carta_20260806,
--              payables_bkp_mp08_autodebit_20260806, payables_bkp_supplier_card_20260807,
--              payables_installment_placeholder_backup_20260806,
--              riba_method_fix_backup_20260807, riba_method_fix2_backup_20260807,
--              spm_reconcile_backup_20260806_banktx, spm_reconcile_backup_20260806_logs,
--              spm_reconcile_backup_20260806_payables
--   Made  (1): payables_bkp_mp08_autodebit_20260806
--   Zago  (1): payables_bkp_mp08_autodebit_20260806
--
-- FIX: ENABLE ROW LEVEL SECURITY, senza creare policy. In PostgreSQL una
-- tabella con RLS attivo e zero policy e' chiusa per default a tutti i ruoli
-- non-bypass: anon e authenticated leggono 0 righe via API. I ruoli
-- `postgres` e `service_role` hanno BYPASSRLS (verificato sui 3 tenant),
-- quindi le Edge Function, gli script di manutenzione e le query MCP
-- continuano ad accedere ai backup esattamente come prima.
--
-- 🚫 NO DATA LOSS: nessuna riga viene toccata, nessuna tabella droppata.
--    I backup restano integri e consultabili da service_role. Questa
--    migration cambia solo CHI puo' leggerli attraverso l'API pubblica.
--
-- Lo sweep e' DINAMICO (non una lista fissa): coerente con la regola
-- "RLS su ogni tabella, nessuna eccezione" del progetto, e parity-safe —
-- ogni tenant blinda le proprie tabelle, anche se l'elenco differisce.
--
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago (3 project_id).
-- =====================================================================

DO $$
DECLARE
  t   RECORD;
  cnt INTEGER := 0;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    cnt := cnt + 1;
    RAISE NOTICE 'RLS abilitato su public.%', t.relname;
  END LOOP;
  RAISE NOTICE '152 — RLS abilitato su % tabelle public', cnt;
END $$;

-- Verifica (deve restituire 0 righe: nessuna tabella public senza RLS):
--   SELECT c.relname
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false;
