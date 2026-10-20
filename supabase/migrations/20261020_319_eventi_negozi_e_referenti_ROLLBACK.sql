-- ROLLBACK 319 (solo con conferma di Patrizio: toglie eventi e referenti salvati).
DROP FUNCTION IF EXISTS public.organico_imposta_referente(uuid, uuid);
ALTER TABLE public.outlets DROP COLUMN IF EXISTS referente_employee_id;
DROP TABLE IF EXISTS public.outlet_events;
DROP FUNCTION IF EXISTS public.outlet_events_fabbisogno();
