-- =====================================================================
-- ROLLBACK 222 — toglie il giorno limite configurabile: la vista torna alla
-- 221 (giorno fisso 15) e la colonna viene rimossa. Prima di eseguire,
-- salvare i valori: create table _bkp_vat_settings_<data> as select * from public.vat_settings;
-- Per la definizione della vista a giorno fisso vedere
-- 20260914_221_iva_competenza_fatture_passive.sql (da riapplicare dopo il DROP COLUMN).
-- =====================================================================
BEGIN;
-- 1) riapplicare la vista della 221 (non dipende dalla colonna)
-- 2) poi:
ALTER TABLE public.vat_settings DROP COLUMN IF EXISTS competenza_cutoff_day;
COMMIT;
