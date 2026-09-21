-- NZ_ONLY 242 — classifica i quattro documenti caricati da «Documenti generali».
--
-- Il 18/09 sono stati caricati in archivio il prospetto ferie in importi e le tre
-- basi di calcolo INAIL mandate dalla consulente. Sono entrati con modulo,
-- funzione, periodo e bucket VUOTI, perche' la porta «Documenti generali»
-- dell'Hub scriveva in import_documents solo nome, percorso, peso e fonte.
-- Il difetto e' corretto nel codice; qui si recuperano le righe gia' scritte.
--
-- NO DATA LOSS: solo UPDATE di campi vuoti su quattro righe, nessuna cancellazione.

BEGIN;

UPDATE import_documents
   SET modulo = 'Personale',
       funzione = 'Documenti generali · costo del lavoro (consulente)',
       storage_bucket = coalesce(storage_bucket, 'general-documents'),
       year = 2026,
       month = 8
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND source = 'general_docs'
   AND modulo IS NULL
   AND file_name IN ('Fer_Perm_Importo.pdf');

UPDATE import_documents
   SET modulo = 'Personale',
       funzione = 'Documenti generali · basi di calcolo INAIL',
       storage_bucket = coalesce(storage_bucket, 'general-documents'),
       year = 2026
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND source = 'general_docs'
   AND modulo IS NULL
   AND file_name LIKE 'BASE_DI_CALCOLO_%';

COMMIT;
