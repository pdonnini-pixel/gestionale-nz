-- =====================================================================
-- ROLLBACK 308 — la vista torna a contare tutta l'IVA delle fatture (anche
-- art. 74) e a togliere ABS(IVA) delle note di credito.
-- 1) Riapplicare la CREATE OR REPLACE VIEW public.v_iva_componenti_mensili di
--    20260914_223_iva_chiusura_registro.sql (non usa la colonna nuova).
-- 2) Solo dopo, e solo con conferma binaria di Patrizio (la colonna e'
--    generata dall'XML, nessun dato si perde ma e' un DROP COLUMN):
-- =====================================================================
BEGIN;
ALTER TABLE public.electronic_invoices DROP COLUMN IF EXISTS vat_non_detraibile;
DROP FUNCTION IF EXISTS public.iva_art74_da_xml(text);
COMMIT;
