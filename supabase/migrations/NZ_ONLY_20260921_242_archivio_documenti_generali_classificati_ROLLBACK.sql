-- ROLLBACK di NZ_ONLY 242 — rimette a vuoto i campi dei quattro documenti.
BEGIN;
UPDATE import_documents
   SET modulo = NULL, funzione = NULL, storage_bucket = NULL, year = NULL, month = NULL
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND source = 'general_docs'
   AND (file_name = 'Fer_Perm_Importo.pdf' OR file_name LIKE 'BASE_DI_CALCOLO_%');
COMMIT;
