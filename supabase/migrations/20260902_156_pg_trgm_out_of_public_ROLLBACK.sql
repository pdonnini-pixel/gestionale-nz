-- =====================================================================
-- ROLLBACK Migrazione 156 — pg_trgm torna in public
-- =====================================================================
-- ⚠️ Da usare solo se qualcosa smette di risolvere `similarity()` o
--    l'operatore `%`. Riporta l'advisor 0014 a segnalare pg_trgm.
--
-- La PARTE A (search_path esteso) NON viene annullata di proposito:
-- avere `extensions` in coda al search_path e' innocuo con pg_trgm in
-- public — public mantiene la precedenza — e toglierlo rischierebbe di
-- rompere le funzioni che nel frattempo si appoggiano ad altre extension
-- gia' residenti in `extensions` (pgcrypto, uuid-ossp).
-- =====================================================================

DO $$
DECLARE
  schema_attuale TEXT;
BEGIN
  SELECT n.nspname INTO schema_attuale
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';

  IF schema_attuale = 'extensions' THEN
    EXECUTE 'ALTER EXTENSION pg_trgm SET SCHEMA public';
    RAISE NOTICE 'ROLLBACK 156 — pg_trgm riportata in public';
  ELSE
    RAISE NOTICE 'ROLLBACK 156 — pg_trgm non e'' in extensions (%): niente da fare', schema_attuale;
  END IF;
END $$;
