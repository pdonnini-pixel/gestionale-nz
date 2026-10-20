-- ROLLBACK 320 (solo con conferma di Patrizio: toglie piani, traffico, HR e controproposte salvati).
DROP FUNCTION IF EXISTS public.leave_rispondi_controproposta(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.leave_controproponi(uuid, jsonb, text);
DROP TABLE IF EXISTS public.leave_counterproposals;
DROP TRIGGER IF EXISTS trg_shifts_mese_chiuso ON public.shifts;
ALTER TABLE public.shifts DROP COLUMN IF EXISTS plan_id;
DROP TABLE IF EXISTS public.shift_plan_weekend_off;
DROP TABLE IF EXISTS public.shift_plans;
DROP FUNCTION IF EXISTS public.turni_blocca_mese_chiuso();
DROP FUNCTION IF EXISTS public.turni_mese_chiuso(uuid, date);
DROP FUNCTION IF EXISTS public.turni_scegli_piano(uuid);
DROP FUNCTION IF EXISTS public.shift_plans_guardia();
DROP TABLE IF EXISTS public.outlet_traffic_hourly;
DROP FUNCTION IF EXISTS public.organico_e_hr();
DROP TABLE IF EXISTS public.organico_hr;
