-- =====================================================================
-- ROLLBACK 223 — toglie la data di chiusura del registro: la vista torna
-- alla 222 (solo giorno limite standard) e la colonna viene rimossa.
-- Prima di eseguire, salvare i valori:
--   create table _bkp_vat_settlements_<data> as select * from public.vat_settlements;
-- Per la definizione della vista a giorno limite fisso vedere
-- 20260914_222_iva_competenza_giorno_limite.sql (da riapplicare prima del DROP COLUMN).
-- =====================================================================
BEGIN;
-- 1) riapplicare la vista della 222 (non dipende dalla colonna)
-- 2) poi:
ALTER TABLE public.vat_settlements DROP COLUMN IF EXISTS registro_chiuso_il;
COMMIT;
