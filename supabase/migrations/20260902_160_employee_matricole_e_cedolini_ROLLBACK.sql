-- Rollback 160. I dati restano in employee_costs: le due tabelle sono derivate.
DROP TABLE IF EXISTS public.employee_cost_slips;
DROP TABLE IF EXISTS public.employee_matricole;
