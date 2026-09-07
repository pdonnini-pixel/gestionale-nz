-- =====================================================================
-- ROLLBACK 193 — Liquidazione IVA mensile previsionale
-- =====================================================================
-- Rimuove la vista e le due tabelle introdotte dalla 193. Le tabelle
-- contengono solo parametri e conferme inserite dalla pagina Liquidazione
-- IVA: prima di eseguire, salvare un backup (REGOLA GRANITICA NO DATA LOSS):
--   create table _bkp_vat_settings_<data>    as select * from public.vat_settings;
--   create table _bkp_vat_settlements_<data> as select * from public.vat_settlements;
-- Nessuna tabella preesistente viene toccata.
-- =====================================================================
BEGIN;

DROP VIEW IF EXISTS public.v_iva_componenti_mensili;
DROP TABLE IF EXISTS public.vat_settlements;
DROP TABLE IF EXISTS public.vat_settings;

COMMIT;
