-- =====================================================================
-- ROLLBACK della migrazione 367 (avvisi sul telefono, app New Zago)
-- =====================================================================
-- Rimette il cron com'era con la 348 (ogni 10 minuti, Edge Function
-- timbrature-avvisi) e toglie le funzioni nuove. NON tocca i dati:
-- employee_push_tokens, attendance_alerts e le 7 colonne nuove di
-- attendance_settings restano. Per toglierle serve prima un backup e la
-- conferma di Patrizio (regola NO DATA LOSS): le istruzioni sono in fondo,
-- commentate.
-- Tenant: NZ e Zago (Made non ha la 348 né la 367).

BEGIN;

-- 1. Il tick torna a chiamare timbrature-avvisi (testo identico alla 348)
CREATE OR REPLACE FUNCTION public.timbrature_avvisi_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net', 'vault', 'pg_temp'
AS $function$
DECLARE
  v_secret  text;
  v_url     text;
  v_anon    text;
  v_request bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.timbrature_da_avvisare(now())) THEN
    RETURN NULL;
  END IF;
  SELECT decrypted_secret::text INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'autofix_cron_secret' LIMIT 1;
  SELECT replace(function_url, 'daily-cash-report-send', 'timbrature-avvisi'), anon_key
    INTO v_url, v_anon FROM public.daily_report_endpoint();
  IF v_secret IS NULL OR v_url IS NULL OR v_anon IS NULL THEN
    RAISE NOTICE 'timbrature_avvisi_tick: segreto o endpoint mancante, nessun invio';
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url     := v_url,
    body    := jsonb_build_object('at', now()),
    params  := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type',   'application/json',
                 'Authorization',  'Bearer ' || v_anon,
                 'apikey',         v_anon,
                 'x-autofix-cron', v_secret),
    timeout_milliseconds := 60000
  ) INTO v_request;
  RETURN v_request;
END;
$function$;
REVOKE ALL ON FUNCTION public.timbrature_avvisi_tick() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timbrature_avvisi_tick() TO service_role;

SELECT cron.schedule('timbrature-avvisi-tick', '*/10 * * * *',
  $cron$SELECT public.timbrature_avvisi_tick();$cron$);

-- 2. Funzioni nuove della 367
DROP FUNCTION IF EXISTS public.timbrature_avvisi_da_mandare(timestamptz);
DROP FUNCTION IF EXISTS public.get_fcm_service_account();
DROP FUNCTION IF EXISTS public.app_push_stato(uuid);
DROP FUNCTION IF EXISTS public.app_registra_push_token(text, text);

COMMIT;

-- 3. SOLO con backup e conferma di Patrizio (dati veri: telefoni e avvisi):
-- SELECT * FROM public.employee_push_tokens;   -- backup
-- SELECT * FROM public.attendance_alerts;      -- backup
-- DROP TABLE public.attendance_alerts;
-- DROP TABLE public.employee_push_tokens;
-- ALTER TABLE public.attendance_settings
--   DROP COLUMN avvisi_push, DROP COLUMN ritardo_attivo, DROP COLUMN ritardo_minuti,
--   DROP COLUMN uscita_attivo, DROP COLUMN avvisa_dipendente,
--   DROP COLUMN avvisa_responsabile, DROP COLUMN avvisa_ufficio;
