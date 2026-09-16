-- ROLLBACK 224 — toglie la voce tax free. Prima di eseguire, salvare i valori:
--   create table _bkp_vat_settlements_<data> as select * from public.vat_settlements;
BEGIN;
ALTER TABLE public.vat_settlements DROP COLUMN IF EXISTS iva_taxfree;
COMMIT;
