-- Rollback della 315 (organico di oggi, orari dei negozi, turni).
-- ATTENZIONE: cancella i cambiamenti segnati, gli orari, il fabbisogno e i
-- turni. Prima di eseguirlo: SELECT * di backup delle sei tabelle e
-- conferma di Patrizio (regola NO DATA LOSS).
BEGIN;
DROP FUNCTION IF EXISTS public.organico_riconcilia();
DROP FUNCTION IF EXISTS public.organico_nuova_persona(text, text, uuid, text, numeric, date, date, text, text, text);
DROP TABLE IF EXISTS public.shifts;
DROP TABLE IF EXISTS public.outlet_shift_rules;
DROP TABLE IF EXISTS public.outlet_special_days;
DROP TABLE IF EXISTS public.outlet_staffing_needs;
DROP TABLE IF EXISTS public.outlet_opening_hours;
DROP TABLE IF EXISTS public.employee_events;
DROP FUNCTION IF EXISTS public.shifts_no_hard_delete();
DROP FUNCTION IF EXISTS public.shifts_touch();
DROP FUNCTION IF EXISTS public.outlet_special_days_fabbisogno();
DROP FUNCTION IF EXISTS public.employee_events_no_delete();
DROP FUNCTION IF EXISTS public.employee_events_touch();
DROP FUNCTION IF EXISTS public.organico_puo_decidere_fabbisogno();
DROP FUNCTION IF EXISTS public.organico_puo_scrivere();
COMMIT;
