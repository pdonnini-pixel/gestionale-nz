-- ROLLBACK 269 — toglie document_type dalla vista e dalla tabella.
-- ATTENZIONE: DROP COLUMN perde i tipi documento registrati. Solo con conferma di Patrizio.
BEGIN;
-- Ricreare v_payables_operative con la definizione della migration 182 (senza document_type):
-- serve DROP VIEW + CREATE perche' CREATE OR REPLACE non toglie colonne.
-- ALTER TABLE public.payables DROP CONSTRAINT IF EXISTS payables_document_type_check;
-- ALTER TABLE public.payables DROP COLUMN IF EXISTS document_type;
COMMIT;
