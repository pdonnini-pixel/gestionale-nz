-- ROLLBACK di NZ_ONLY 369: toglie il dipendente di prova e le sue righe.
-- Sono solo dati finti (employees.is_demo = true): nessun dato vero cambia.
BEGIN;

-- 1. Dipendenti di prova e le loro righe (solo dati finti)
DELETE FROM public.leave_request_days d USING public.leave_requests q, public.employees e
 WHERE d.request_id = q.id AND q.employee_id = e.id AND e.is_demo;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'attendance_alerts', 'attendance_notifications', 'attendance_punches', 'employee_app_access',
    'employee_availability', 'employee_cost_slips', 'employee_costs', 'employee_documents',
    'employee_events', 'employee_matricole', 'employee_outlet_allocations', 'employee_push_tokens',
    'employee_trasferte', 'leave_accrual_rows', 'leave_counterproposals', 'leave_requests',
    'personnel_gross_cost_employee', 'shift_plan_weekend_off', 'shifts'
  ] LOOP
    EXECUTE format('DELETE FROM public.%I x USING public.employees e WHERE x.employee_id = e.id AND e.is_demo', t);
  END LOOP;
END;
$$;
DELETE FROM public.employees WHERE is_demo;

COMMIT;
