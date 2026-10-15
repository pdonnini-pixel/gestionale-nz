-- =====================================================================
-- ROLLBACK 309 — il ricavo del giorno torna corrispettivi + fatture, senza
-- togliere gli storni di altri giorni.
-- 1) Riapplicare la funzione project_cash_closing_to_daily_revenue di
--    20261013_303_ricavo_giorno_con_fatture.sql (solo la CREATE FUNCTION,
--    non il blocco DO di riproiezione).
-- 2) Poi:
-- =====================================================================
BEGIN;
DROP TRIGGER IF EXISTS trg_cash_closing_attachment_reproject ON public.outlet_daily_closing_attachments;
DROP FUNCTION IF EXISTS public.fn_cash_closing_attachment_reproject();
DROP FUNCTION IF EXISTS public.storni_altri_giorni_da_foto(uuid);
COMMIT;
-- 3) Riproiettare le chiusure che avevano storni (note di daily_revenue con
--    «annulli/resi di altri giorni») con project_cash_closing_to_daily_revenue.
