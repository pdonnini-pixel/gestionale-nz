-- ROLLBACK della 375: rimette i privilegi di default (la RLS continua a bloccare le scritture).
BEGIN;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.attendance_confermatori, public.attendance_eventi, public.attendance_regole_dipendente TO authenticated;
COMMIT;
