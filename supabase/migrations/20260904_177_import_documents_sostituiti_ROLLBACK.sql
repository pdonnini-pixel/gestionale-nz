-- ROLLBACK di 177. Toglie le due colonne: i file restano tutti, si perde solo
-- l'informazione su quale versione ha sostituito quale.
BEGIN;
DROP INDEX IF EXISTS idx_import_documents_correnti;
DROP INDEX IF EXISTS idx_import_documents_periodo;
ALTER TABLE import_documents DROP COLUMN IF EXISTS superseded_by;
ALTER TABLE import_documents DROP COLUMN IF EXISTS superseded_at;
COMMIT;
