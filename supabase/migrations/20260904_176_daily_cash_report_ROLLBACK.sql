-- ROLLBACK migrazione 176 — report incassi serale
-- ⚠️ NO DATA LOSS: cancella impostazioni e log degli invii. Solo dopo
-- backup e conferma binaria di Patrizio.
BEGIN;
SELECT cron.unschedule('daily-cash-report-tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-cash-report-tick');
DROP FUNCTION IF EXISTS public.daily_cash_report_tick(text, text);
DROP TABLE IF EXISTS public.daily_report_log;
DROP TABLE IF EXISTS public.daily_report_settings;
COMMIT;
