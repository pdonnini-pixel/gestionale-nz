-- ROLLBACK 157. Le colonne sono additive: rimuoverle riporta esattamente allo
-- stato precedente, perché nessun dato preesistente è stato modificato.
-- Attenzione: elimina anche gli snapshot dei ricarichi (removed_snapshot).
BEGIN;
DROP INDEX IF EXISTS idx_employee_costs_outlet_period;
ALTER TABLE public.employee_costs DROP COLUMN IF EXISTS outlet_code;
ALTER TABLE public.employee_costs DROP COLUMN IF EXISTS outlet_source;
ALTER TABLE public.employee_cost_imports DROP COLUMN IF EXISTS removed_snapshot;
ALTER TABLE public.employee_cost_imports DROP COLUMN IF EXISTS rows_removed;
COMMIT;
