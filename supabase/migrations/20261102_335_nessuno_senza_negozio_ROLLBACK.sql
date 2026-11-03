-- Rollback 20261102_335: toglie il trigger. Le ripartizioni gia' create
-- restano (sono dati). Per riportare organico_correggi_persona alla 334
-- rieseguire il corpo della funzione di 20261102_334_organico_correggi_persona.sql.
DROP TRIGGER IF EXISTS trg_employees_ripartizione_da_negozio ON public.employees;
DROP FUNCTION IF EXISTS public.employees_ripartizione_da_negozio();
