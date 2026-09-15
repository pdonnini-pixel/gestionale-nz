-- Rollback 161. employee_costs torna scrivibile direttamente, i valori restano.
DROP TRIGGER IF EXISTS trg_sync_employee_costs_from_slips ON public.employee_cost_slips;
DROP FUNCTION IF EXISTS public.sync_employee_costs_from_slips();
