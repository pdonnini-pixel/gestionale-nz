-- Rollback della 418. ATTENZIONE: toglie le spunte gia' scritte dall'HR. Prima salvare:
--   SELECT id, puo_aprire, puo_chiudere FROM public.employees WHERE puo_aprire IS NOT NULL OR puo_chiudere IS NOT NULL;
DROP FUNCTION IF EXISTS public.employee_chiavi_imposta(uuid, text, boolean);
ALTER TABLE public.employees DROP COLUMN IF EXISTS puo_aprire;
ALTER TABLE public.employees DROP COLUMN IF EXISTS puo_chiudere;
