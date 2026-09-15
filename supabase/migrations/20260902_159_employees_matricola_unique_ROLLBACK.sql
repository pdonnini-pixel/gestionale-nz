-- Rollback 159 — rimuove il vincolo di unicità sulla matricola.
DROP INDEX IF EXISTS public.employees_company_matricola_uniq;
