-- ROLLBACK di 168. ATTENZIONE: elimina gli alias configurati.
-- Prima di eseguirlo, salvarli:
--   select name, payroll_filiali from public.outlets where payroll_filiali is not null;
BEGIN;
ALTER TABLE public.outlets DROP COLUMN IF EXISTS payroll_filiali;
COMMIT;
