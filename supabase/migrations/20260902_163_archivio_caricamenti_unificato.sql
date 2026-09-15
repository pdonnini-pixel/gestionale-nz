-- 163 — Archivio unico dei file caricati. Applicata sui 3 tenant il 02/09/2026.
-- Dieci punti del gestionale leggevano un file e lo buttavano via: del carico
-- restava il nome nel log, non il documento. import_documents diventa il
-- registro unico, con il modulo e la funzione che hanno prodotto il file e il
-- riferimento al dato generato, così da un mese si risale al file e viceversa.
ALTER TABLE public.import_documents
  ADD COLUMN IF NOT EXISTS storage_bucket   text,
  ADD COLUMN IF NOT EXISTS modulo           text,
  ADD COLUMN IF NOT EXISTS funzione         text,
  ADD COLUMN IF NOT EXISTS year             int,
  ADD COLUMN IF NOT EXISTS month            int,
  ADD COLUMN IF NOT EXISTS reference_table  text,
  ADD COLUMN IF NOT EXISTS reference_id     uuid,
  ADD COLUMN IF NOT EXISTS uploaded_by      uuid,
  ADD COLUMN IF NOT EXISTS note             text;

CREATE INDEX IF NOT EXISTS import_documents_company_time_idx ON public.import_documents (company_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS import_documents_periodo_idx ON public.import_documents (company_id, modulo, year, month);
CREATE INDEX IF NOT EXISTS import_documents_riferimento_idx ON public.import_documents (reference_table, reference_id);

-- Legame dal log del carico al file archiviato (nei due sensi).
ALTER TABLE public.employee_cost_imports ADD COLUMN IF NOT EXISTS import_document_id uuid;
ALTER TABLE public.personnel_gross_cost_imports ADD COLUMN IF NOT EXISTS import_document_id uuid;
ALTER TABLE public.personnel_gross_cost_employee_imports ADD COLUMN IF NOT EXISTS import_document_id uuid;
ALTER TABLE public.bank_statements ADD COLUMN IF NOT EXISTS import_document_id uuid;
ALTER TABLE public.employee_cost_slips ADD COLUMN IF NOT EXISTS import_document_id uuid;

COMMENT ON TABLE public.import_documents IS
  'Registro unico dei file caricati dall''utente: chi, quando, da quale funzione, per quale periodo, e dove sta il file su Storage.';
