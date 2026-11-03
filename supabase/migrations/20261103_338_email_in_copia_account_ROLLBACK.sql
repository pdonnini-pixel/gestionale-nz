-- ROLLBACK 338: la colonna contiene dati scelti a mano. Prima di toglierla,
-- backup e conferma di Patrizio (regola NO DATA LOSS).
-- ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_email_cc_formato;
-- ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS email_cc;
SELECT 1;
