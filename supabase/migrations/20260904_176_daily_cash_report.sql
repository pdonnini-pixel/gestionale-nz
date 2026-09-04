-- =====================================================================
-- 176 — Report incassi serale (fase 2 dello specchietto incassi)
--
-- Ogni sera, all'ora scelta in Impostazioni → «Report incassi serale»,
-- i destinatari ricevono via mail il riepilogo delle chiusure di cassa
-- del giorno (una riga per punto vendita, mancanti in evidenza,
-- anomalie, progressivo del mese).
--
-- Pezzi:
--   1. daily_report_settings  — configurazione per azienda (ora locale,
--      destinatari, sollecito, invio anche senza chiusure, URL dell'app)
--   2. daily_report_log       — ogni invio (o sollecito) con esito
--   3. daily_cash_report_tick(url, anon) — chiamata da pg_cron ogni
--      15 minuti: converte now() nel fuso dell'azienda (Europe/Rome),
--      e se e' l'ora giusta e il report di oggi non e' ancora partito
--      chiama la edge function daily-cash-report-send via pg_net con il
--      segreto condiviso x-autofix-cron (stesso schema di migration 156).
--      Il sollecito (reminder_time) crea invece una notifica in-app agli
--      operatori cassa dei negozi che non hanno ancora confermato.
--
-- Additiva: nessun DROP, nessuna modifica a tabelle esistenti.
-- Da applicare su NZ → Made → Zago. La schedulazione pg_cron sta in fondo
-- (commentata, una riga per tenant, come nella 156).
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 1. Impostazioni per azienda
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_report_settings (
  company_id     uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  enabled        boolean NOT NULL DEFAULT false,
  -- Ora LOCALE (nel fuso 'timezone'), cosi' l'ora legale non sposta l'invio.
  send_time      time NOT NULL DEFAULT '21:30',
  reminder_time  time,
  timezone       text NOT NULL DEFAULT 'Europe/Rome',
  recipients     text[] NOT NULL DEFAULT '{}',
  -- Mandare la mail anche nei giorni senza nessuna chiusura registrata.
  send_on_empty  boolean NOT NULL DEFAULT true,
  -- Origine del sito (es. https://gestionale-nz.netlify.app), salvata dalla
  -- UI: serve per i link nella mail. Mai hardcoded per tenant.
  app_url        text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid
);

ALTER TABLE public.daily_report_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS drs_select ON public.daily_report_settings;
CREATE POLICY drs_select ON public.daily_report_settings
  FOR SELECT USING (company_id = public.get_my_company_id());
DROP POLICY IF EXISTS drs_write ON public.daily_report_settings;
CREATE POLICY drs_write ON public.daily_report_settings
  FOR ALL USING (company_id = public.get_my_company_id()
                 AND public.get_my_role()::text IN ('super_advisor', 'contabile'))
  WITH CHECK (company_id = public.get_my_company_id()
              AND public.get_my_role()::text IN ('super_advisor', 'contabile'));
-- L'operatore cassa non vede la configurazione (stessa policy restrittiva della 172).
DROP POLICY IF EXISTS cash_operator_block ON public.daily_report_settings;
CREATE POLICY cash_operator_block ON public.daily_report_settings AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (COALESCE(public.get_my_role()::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE(public.get_my_role()::text, '') <> 'operatore_cassa');

-- ---------------------------------------------------------------------
-- 2. Log degli invii
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_report_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  report_date  date NOT NULL,
  kind         text NOT NULL DEFAULT 'report' CHECK (kind IN ('report', 'reminder', 'test')),
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  recipients   text[] NOT NULL DEFAULT '{}',
  subject      text,
  summary      jsonb,
  error        text,
  request_id   bigint,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);

-- Un solo report (e un solo sollecito) al giorno per azienda: la riga
-- 'queued' viene inserita PRIMA della chiamata, cosi' due tick vicini non
-- mandano due mail. I test non contano.
CREATE UNIQUE INDEX IF NOT EXISTS daily_report_log_once_per_day
  ON public.daily_report_log (company_id, report_date, kind)
  WHERE status IN ('queued', 'sent') AND kind <> 'test';
CREATE INDEX IF NOT EXISTS daily_report_log_company_date
  ON public.daily_report_log (company_id, report_date DESC);

ALTER TABLE public.daily_report_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS drl_select ON public.daily_report_log;
CREATE POLICY drl_select ON public.daily_report_log
  FOR SELECT USING (company_id = public.get_my_company_id());
-- Scrive solo il backend (service role / funzioni SECURITY DEFINER).
DROP POLICY IF EXISTS cash_operator_block ON public.daily_report_log;
CREATE POLICY cash_operator_block ON public.daily_report_log AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (COALESCE(public.get_my_role()::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE(public.get_my_role()::text, '') <> 'operatore_cassa');

-- ---------------------------------------------------------------------
-- 3. Il tick: ogni 15 minuti, in ora locale
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.daily_cash_report_tick(
  p_function_url text,
  p_anon_key     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, vault, pg_temp
AS $$
DECLARE
  v_secret     text;
  s            record;
  v_local      timestamp;
  v_today      date;
  v_time       time;
  v_log_id     uuid;
  v_request    bigint;
  v_sent       integer := 0;
  v_reminded   integer := 0;
  v_missing    record;
  v_names      text[];
  v_users      uuid[];
BEGIN
  SELECT decrypted_secret::text INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'autofix_cron_secret' LIMIT 1;
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'autofix_cron_secret assente nel vault: la edge function rifiuterebbe la chiamata';
  END IF;

  FOR s IN SELECT * FROM public.daily_report_settings WHERE enabled LOOP
    v_local := now() AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Europe/Rome');
    v_today := v_local::date;
    v_time  := v_local::time;

    -- Report serale: finestra di 30 minuti dall'ora impostata (il cron gira
    -- ogni 15), una sola volta al giorno grazie all'indice parziale.
    IF cardinality(s.recipients) > 0
       AND v_time >= s.send_time AND v_time < s.send_time + interval '30 minutes'
       AND NOT EXISTS (SELECT 1 FROM public.daily_report_log
                        WHERE company_id = s.company_id AND report_date = v_today
                          AND kind = 'report' AND status IN ('queued', 'sent')) THEN
      INSERT INTO public.daily_report_log (company_id, report_date, kind, status, recipients)
      VALUES (s.company_id, v_today, 'report', 'queued', s.recipients)
      RETURNING id INTO v_log_id;

      SELECT net.http_post(
        url     := p_function_url,
        body    := jsonb_build_object('log_id', v_log_id, 'company_id', s.company_id,
                                      'report_date', v_today, 'kind', 'report'),
        params  := '{}'::jsonb,
        headers := jsonb_build_object(
                     'Content-Type',   'application/json',
                     'Authorization',  'Bearer ' || p_anon_key,
                     'apikey',         p_anon_key,
                     'x-autofix-cron', v_secret),
        timeout_milliseconds := 120000
      ) INTO v_request;
      UPDATE public.daily_report_log SET request_id = v_request WHERE id = v_log_id;
      v_sent := v_sent + 1;
    END IF;

    -- Sollecito in-app ai negozi che non hanno ancora confermato la chiusura di oggi.
    IF s.reminder_time IS NOT NULL
       AND v_time >= s.reminder_time AND v_time < s.reminder_time + interval '30 minutes'
       AND NOT EXISTS (SELECT 1 FROM public.daily_report_log
                        WHERE company_id = s.company_id AND report_date = v_today
                          AND kind = 'reminder' AND status IN ('queued', 'sent')) THEN
      v_names := '{}'; v_users := '{}';
      FOR v_missing IN
        SELECT o.id, o.name
          FROM public.outlets o
         WHERE o.company_id = s.company_id AND COALESCE(o.is_active, true)
           AND lower(COALESCE(o.outlet_type, 'outlet')) NOT IN ('sede', 'magazzino', 'warehouse', 'hq', 'ufficio')
           AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                            WHERE c.outlet_id = o.id AND c.closing_date = v_today
                              AND c.status IN ('confermata', 'verificata'))
         ORDER BY o.name
      LOOP
        v_names := v_names || v_missing.name;
        INSERT INTO public.notifications
          (company_id, user_id, title, message, category, severity, action_url, action_label, reference_type)
        SELECT s.company_id, uoa.user_id,
               'Chiusura cassa di oggi non ancora confermata: ' || v_missing.name,
               'Il report serale parte alle ' || to_char(s.send_time, 'HH24:MI')
                 || '. Compila e conferma la chiusura di ' || v_missing.name || ' prima di allora.',
               'info', 'warning',
               '/chiusura-cassa?outlet=' || v_missing.id::text || '&date=' || to_char(v_today, 'YYYY-MM-DD'),
               'Apri la chiusura cassa', 'cash_closing_reminder'
          FROM public.user_outlet_access uoa
          JOIN public.user_profiles up ON up.id = uoa.user_id
         WHERE uoa.outlet_id = v_missing.id AND up.role::text = 'operatore_cassa'
           AND COALESCE(up.is_active, true);
      END LOOP;
      INSERT INTO public.daily_report_log (company_id, report_date, kind, status, recipients, sent_at, summary)
      VALUES (s.company_id, v_today, 'reminder', 'sent', v_names, now(),
              jsonb_build_object('missing_outlets', cardinality(v_names)));
      v_reminded := v_reminded + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('reports', v_sent, 'reminders', v_reminded, 'at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.daily_cash_report_tick(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daily_cash_report_tick(text, text) TO service_role;

COMMIT;

-- =====================================================================
-- SCHEDULAZIONE (fuori transazione, UNA riga per tenant — ogni 15 minuti).
-- La anon key e' pubblica (sta gia' nel bundle JS): serve solo a passare il
-- gateway verify_jwt; l'autorizzazione vera e' il segreto x-autofix-cron.
-- Applicate tutte e tre il 2026-09-04.
-- =====================================================================
-- NZ   — xfvfxsvqpnpvibgeqpqp
-- SELECT cron.schedule('daily-cash-report-tick', '*/15 * * * *', $cron$
--   SELECT public.daily_cash_report_tick(
--     'https://xfvfxsvqpnpvibgeqpqp.supabase.co/functions/v1/daily-cash-report-send',
--     '<anon key NZ>');
-- $cron$);
-- Made — wdgoebzvosspjqttitra: stessa riga con URL e anon key di Made.
-- Zago — jxlwvzjreukscnswkbjx: stessa riga con URL e anon key di Zago.
--
-- Verifica:  SELECT jobname, schedule, active FROM cron.job WHERE jobname='daily-cash-report-tick';
-- Storico :  SELECT status, return_message, start_time FROM cron.job_run_details
--              WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='daily-cash-report-tick')
--              ORDER BY start_time DESC LIMIT 5;
-- Invii   :  SELECT report_date, kind, status, recipients, error FROM public.daily_report_log
--             ORDER BY created_at DESC LIMIT 10;
