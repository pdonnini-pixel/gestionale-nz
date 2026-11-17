-- ROLLBACK 428 — ferma il consuntivo automatico del primo del mese.
-- I consuntivi già scritti in budget_confronto RESTANO (sono dati). Il registro
-- budget_consuntivo_auto conserva il valore precedente di ogni negozio e mese: prima di
-- togliere le tabelle, salvarlo (SELECT * FROM public.budget_consuntivo_auto) e chiedere a
-- Patrizio (NO DATA LOSS). Qui si ferma solo il giro e si tolgono le funzioni.
SELECT cron.unschedule('consuntivo-mese-chiuso-tick');

BEGIN;
DROP FUNCTION IF EXISTS public.fn_consuntivo_mese_chiuso_tick();
DROP FUNCTION IF EXISTS public.fn_consuntivo_mese_chiuso(uuid, date, boolean);
-- Tabelle e colonna lasciate al loro posto di proposito (contengono lo storico):
-- DROP TABLE public.budget_consuntivo_runs; DROP TABLE public.budget_consuntivo_auto;
-- ALTER TABLE public.daily_report_settings DROP COLUMN consuntivo_avviso_recipients;
COMMIT;
