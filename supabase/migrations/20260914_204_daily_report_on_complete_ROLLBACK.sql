-- Rollback 204 — torna al report a ora fissa (migration 176 + 201).
-- Non tocca i dati: le colonne restano (con i default) per non perdere nulla;
-- il trigger e le funzioni nuove vengono rimossi, il tick torna alla versione 176.
BEGIN;
DROP TRIGGER IF EXISTS trg_cash_closing_report_dispatch ON public.outlet_daily_closings;
DROP FUNCTION IF EXISTS public.fn_cash_closing_report_dispatch();
DROP FUNCTION IF EXISTS public.daily_report_dispatch(uuid, date, text, uuid, text);
DROP FUNCTION IF EXISTS public.daily_report_is_complete(uuid, date);
DROP FUNCTION IF EXISTS public.daily_report_endpoint();
-- Ripristinare daily_cash_report_tick dalla migration 20260904_176 (sezione 3).
-- Le colonne send_mode / followup_enabled / closing_id / outlet_name restano.
-- Per riportare l'indice alla forma 176:
-- DROP INDEX IF EXISTS public.daily_report_log_once_per_day;
-- CREATE UNIQUE INDEX daily_report_log_once_per_day ON public.daily_report_log (company_id, report_date, kind)
--   WHERE status IN ('queued','sent') AND kind <> 'test';
COMMIT;
