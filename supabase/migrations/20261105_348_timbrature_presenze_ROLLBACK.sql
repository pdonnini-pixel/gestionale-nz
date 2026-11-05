-- ROLLBACK migrazione 348 — timbrature e presenze.
-- ATTENZIONE NO DATA LOSS: le tabelle attendance_* contengono timbrature vere
-- (LUL, conservazione 5 anni). Prima di eseguire questo rollback serve un
-- backup (SELECT * di attendance_punches, attendance_notifications,
-- attendance_settings, employee_app_access) e la conferma di Patrizio.
-- Le colonne employees.user_id e employees.telefono_whatsapp NON si tolgono
-- qui: contengono dati inseriti a mano; si lasciano vuote e inutilizzate.
-- Paracadute: se ci sono timbrature il rollback si ferma. Per procedere
-- davvero, dopo backup e conferma, togliere a mano questo blocco.
DO $$
BEGIN
  IF to_regclass('public.attendance_punches') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.attendance_punches) THEN
    RAISE EXCEPTION 'attendance_punches contiene timbrature: serve backup e conferma di Patrizio prima del rollback';
  END IF;
END $$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'timbrature-avvisi-tick';

BEGIN;
DROP TRIGGER IF EXISTS trg_employees_accesso_app ON public.employees;
DROP FUNCTION IF EXISTS public.get_twilio_timbrature_template();
DROP FUNCTION IF EXISTS public.timbrature_avvisi_tick();
DROP FUNCTION IF EXISTS public.timbrature_da_avvisare(timestamptz);
DROP FUNCTION IF EXISTS public.timbrature_conferma(uuid);
DROP FUNCTION IF EXISTS public.timbrature_annulla(uuid, text);
DROP FUNCTION IF EXISTS public.app_accesso_nuovo_codice(uuid);
DROP FUNCTION IF EXISTS public.app_accessi_elenco(uuid);
DROP FUNCTION IF EXISTS public.app_dipendente_consuma_codice(text);
DROP FUNCTION IF EXISTS public.app_dipendente_dichiara_uscita(date, time, text);
DROP FUNCTION IF EXISTS public.app_dipendente_oggi();
DROP FUNCTION IF EXISTS public.timbrature_registra(jsonb);
DROP FUNCTION IF EXISTS public.timbrature_firma(text, uuid, bigint);
DROP FUNCTION IF EXISTS public.timbratrice_dati(uuid);
DROP FUNCTION IF EXISTS public.timbratrice_negozi();
DROP FUNCTION IF EXISTS public.timbrature_puo_timbrare(uuid);
DROP FUNCTION IF EXISTS public.timbrature_turni_ufficiali(uuid, date, date);
DROP TABLE IF EXISTS public.attendance_notifications;
DROP TABLE IF EXISTS public.attendance_punches;
DROP TABLE IF EXISTS public.attendance_settings;
DROP FUNCTION IF EXISTS public.timbrature_crea_accesso();
DROP TABLE IF EXISTS public.employee_app_access;
DROP FUNCTION IF EXISTS public.timbrature_nuovo_codice();
DROP FUNCTION IF EXISTS public.timbrature_gestore();
DROP FUNCTION IF EXISTS public.timbrature_mio_dipendente();
COMMIT;
