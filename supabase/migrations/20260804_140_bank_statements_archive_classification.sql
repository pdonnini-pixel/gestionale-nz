-- 20260804_140_bank_statements_archive_classification.sql
-- Archivio estratti conto: classificazione per tipo/fonte/periodo per rendere
-- l'elenco gestibile e ricercabile quando i documenti diventano centinaia.
-- Additiva e non distruttiva. Applicare a NZ + Made + Zago (REGOLA #0).
--
-- Nuove colonne su bank_statements:
--   doc_kind      → 'conto_corrente' | 'carta' (NULL ammesso per righe storiche)
--   source_label  → intestazione stabile della fonte (es. "Conto Intesa",
--                   "Carta prepagata Tasca *0580", "Carta credito BCC *5388")
--   period_year   → anno del documento (per ricerca/ordinamento)
--   period_month  → mese 1-12 del documento
-- Inoltre bank_account_id diventa NULLABLE: le carte non appartengono a un
-- conto corrente e vengono classificate come categoria a sé (bank_account_id NULL).

BEGIN;

ALTER TABLE public.bank_statements
  ADD COLUMN IF NOT EXISTS doc_kind     text,
  ADD COLUMN IF NOT EXISTS source_label text,
  ADD COLUMN IF NOT EXISTS period_year  integer,
  ADD COLUMN IF NOT EXISTS period_month integer;

-- Le carte non hanno un conto: consenti NULL.
ALTER TABLE public.bank_statements ALTER COLUMN bank_account_id DROP NOT NULL;

-- Vincoli soft (ammettono NULL per non toccare lo storico).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_statements_doc_kind_check') THEN
    ALTER TABLE public.bank_statements
      ADD CONSTRAINT bank_statements_doc_kind_check
      CHECK (doc_kind IS NULL OR doc_kind IN ('conto_corrente','carta'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_statements_period_month_check') THEN
    ALTER TABLE public.bank_statements
      ADD CONSTRAINT bank_statements_period_month_check
      CHECK (period_month IS NULL OR (period_month BETWEEN 1 AND 12));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_bank_statements_archive
  ON public.bank_statements (company_id, doc_kind, period_year, period_month);

COMMIT;
