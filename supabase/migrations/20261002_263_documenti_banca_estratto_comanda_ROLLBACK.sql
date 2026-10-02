-- ROLLBACK della 263 (documenti banca, R27/R28).
-- ATTENZIONE: le tabelle bank_statement_lines, document_corrections,
-- bank_document_questions e bank_document_messages contengono la traccia delle
-- correzioni fatte dagli estratti. Prima di toglierle: backup con SELECT * e
-- conferma di Patrizio (regola granitica no data loss).
-- I movimenti inseriti o corretti da un estratto NON tornano indietro con questo
-- script: i valori precedenti sono in document_corrections (old_value).

BEGIN;

DROP TRIGGER IF EXISTS trg_bank_tx_adopt_estratto ON public.bank_transactions;
DROP FUNCTION IF EXISTS public.trg_bank_tx_adopt_estratto();
DROP FUNCTION IF EXISTS public.apply_bank_statement(uuid, jsonb, numeric, numeric, integer);
DROP FUNCTION IF EXISTS public.fn_bank_doc_ask(uuid, uuid, text, text, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.fn_text_overlap(text, text);
DROP FUNCTION IF EXISTS public.fn_eur_it(numeric);

DROP TABLE IF EXISTS public.bank_document_messages;
DROP TABLE IF EXISTS public.bank_document_questions;
DROP TABLE IF EXISTS public.document_corrections;
DROP TABLE IF EXISTS public.bank_statement_lines;

ALTER TABLE public.bank_transactions DROP COLUMN IF EXISTS statement_confirmed_at;
DROP INDEX IF EXISTS public.bank_statements_content_hash_uq;
ALTER TABLE public.bank_statements
  DROP COLUMN IF EXISTS content_hash,
  DROP COLUMN IF EXISTS balance_check,
  DROP COLUMN IF EXISTS applied_at,
  DROP COLUMN IF EXISTS applied_summary;

COMMIT;
