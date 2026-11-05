-- ROLLBACK migrazioni 350 e 351 — funzioni dell'app del dipendente.
-- Toglie solo le funzioni: richieste di ferie, giorni e notifiche gia' create
-- restano (sono dati veri, si decidono dal gestionale come le altre).
DROP FUNCTION IF EXISTS public.app_dipendente_periodo(date, date);
DROP FUNCTION IF EXISTS public.app_dipendente_ritira_ferie(uuid);
DROP FUNCTION IF EXISTS public.app_dipendente_chiedi_ferie(jsonb, text);
DROP FUNCTION IF EXISTS public.app_dipendente_ferie();
