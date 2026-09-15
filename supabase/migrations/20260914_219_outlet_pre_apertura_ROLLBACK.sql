-- Rollback di 20260914_219_outlet_pre_apertura.sql
-- Rimuove solo le tre colonne aggiunte (e l'indice). Da eseguire soltanto se
-- la 219 va annullata: le colonne sono nullable e nessun'altra tabella le
-- referenzia. Prima di eseguire, salvare i valori eventualmente inseriti:
--   SELECT id, code, rent_start_date, guarantee_expiry, landlord_supplier_id
--   FROM public.outlets WHERE rent_start_date IS NOT NULL
--      OR guarantee_expiry IS NOT NULL OR landlord_supplier_id IS NOT NULL;

BEGIN;

DROP INDEX IF EXISTS public.idx_outlets_landlord_supplier;

ALTER TABLE public.outlets
  DROP COLUMN IF EXISTS landlord_supplier_id,
  DROP COLUMN IF EXISTS guarantee_expiry,
  DROP COLUMN IF EXISTS rent_start_date;

COMMIT;
