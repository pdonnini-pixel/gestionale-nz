-- Rollback 163. I file restano su Storage, si perde solo l'indicizzazione estesa.
DROP INDEX IF EXISTS public.import_documents_company_time_idx;
DROP INDEX IF EXISTS public.import_documents_periodo_idx;
DROP INDEX IF EXISTS public.import_documents_riferimento_idx;
ALTER TABLE public.import_documents
  DROP COLUMN IF EXISTS storage_bucket, DROP COLUMN IF EXISTS modulo,
  DROP COLUMN IF EXISTS funzione, DROP COLUMN IF EXISTS year, DROP COLUMN IF EXISTS month,
  DROP COLUMN IF EXISTS reference_table, DROP COLUMN IF EXISTS reference_id,
  DROP COLUMN IF EXISTS uploaded_by, DROP COLUMN IF EXISTS note;
ALTER TABLE public.employee_cost_imports DROP COLUMN IF EXISTS import_document_id;
ALTER TABLE public.personnel_gross_cost_imports DROP COLUMN IF EXISTS import_document_id;
ALTER TABLE public.personnel_gross_cost_employee_imports DROP COLUMN IF EXISTS import_document_id;
ALTER TABLE public.bank_statements DROP COLUMN IF EXISTS import_document_id;
ALTER TABLE public.employee_cost_slips DROP COLUMN IF EXISTS import_document_id;
