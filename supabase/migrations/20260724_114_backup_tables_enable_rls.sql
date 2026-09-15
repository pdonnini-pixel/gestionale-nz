-- =====================================================================
-- Migrazione 114 — RLS + revoca grant sulle tabelle di BACKUP in public
-- =====================================================================
-- CHIUDE due advisor su tutte le tabelle di backup ad-hoc nello schema public:
--   * 0013_rls_disabled_in_public     (RLS non abilitata su tabella pubblica)
--   * 0023_sensitive_columns_exposed  (colonna `iban` esposta via API senza RLS)
--
-- CONTESTO: durante le sessioni di bonifica dati di giugno-luglio 2026 sono state
-- create diverse tabelle di backup con  CREATE TABLE ... AS SELECT  (snapshot di
-- payables/cash_movements ecc. prima di ogni intervento). Esempi segnalati:
--   _bkp_*_20260709 / _2026071 0 (20 tabelle), payables_dup_backup_20260723,
--   _backup_cash_movements_cat_20260724.
-- Sono snapshot storici: NON vanno mai letti dal frontend, ma essendo in `public`
-- PostgREST li espone via API e diversi contengono la colonna `iban` (dato
-- sensibile). Vanno chiusi all'accesso via API.
--
-- FIX (NON distruttivo — REGOLA GRANITICA NO DATA LOSS): NON si cancella nulla.
-- Si abilita RLS (senza policy → PostgREST nega ogni SELECT ad anon/authenticated,
-- mentre service_role e owner mantengono l'accesso per eventuali ripristini) e in
-- più si revocano i grant ad anon/authenticated (difesa in profondità sul dato
-- `iban`). I dati restano intatti e ripristinabili.
--
-- Sweep DINAMICO per pattern di naming dei backup: ogni tenant ha creato i propri
-- snapshot in sessioni diverse, quindi un elenco fisso non sarebbe parity-safe.
-- Il pattern seleziona SOLO nomi da artefatto-backup (nessuna tabella di dominio
-- inizia per _bkp_/_backup_/backup_<cifra> né contiene _dup_backup_).
--
-- ⚠️ REGOLA #0 — applicare a mano su NZ + Made + Zago (3 project_id). Su un tenant
--    privo di queste tabelle è semplicemente un no-op (0 righe iterate).
-- =====================================================================

DO $$
DECLARE
  t   RECORD;
  cnt INTEGER := 0;
BEGIN
  FOR t IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'                 -- solo tabelle ordinarie
      AND c.relrowsecurity = false        -- solo quelle senza RLS (idempotente)
      AND (
           c.relname LIKE '\_bkp\_%'   ESCAPE '\'   -- _bkp_...
        OR c.relname LIKE '\_backup\_%' ESCAPE '\'  -- _backup_...
        OR c.relname LIKE 'backup\_2%'  ESCAPE '\'  -- backup_2026...
        OR c.relname LIKE '%\_dup\_backup\_%' ESCAPE '\' -- ..._dup_backup_...
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    -- Difesa in profondità: nega esplicitamente l'accesso ai ruoli API.
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t.tablename);
    cnt := cnt + 1;
    RAISE NOTICE 'Backup blindato (RLS on + grant revocati): public.%', t.tablename;
  END LOOP;
  RAISE NOTICE 'Totale tabelle di backup blindate: %', cnt;
END $$;

-- Verifica (deve restituire 0 righe: nessun backup pubblico senza RLS):
--   SELECT c.relname
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false
--     AND (c.relname LIKE '\_bkp\_%' ESCAPE '\'
--       OR c.relname LIKE '\_backup\_%' ESCAPE '\'
--       OR c.relname LIKE 'backup\_2%' ESCAPE '\'
--       OR c.relname LIKE '%\_dup\_backup\_%' ESCAPE '\');
