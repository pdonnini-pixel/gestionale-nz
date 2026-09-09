-- ROLLBACK 203
BEGIN;
DROP FUNCTION IF EXISTS public.get_outlet_day_targets(uuid, date, date);
DROP FUNCTION IF EXISTS public.fn_revenue_season(date);
DROP FUNCTION IF EXISTS public.fn_revenue_day_type(date);
DROP FUNCTION IF EXISTS public.fn_it_easter(integer);
COMMIT;
