-- =====================================================================
-- 204 — Report incassi serale: invio a completamento, ora limite, integrazione
--
-- Problema (11-13 settembre 2026): chi chiude dopo l'ora fissa del report
-- (Valmontone il weekend alle 21:03/21:05, Franciacorta il venerdì alle 23:04)
-- resta fuori dalla mail e dal WhatsApp, che fotografano una giornata incompleta.
--
-- Cosa cambia:
--   1. daily_report_settings.send_mode
--        'fixed'        → come prima: il report parte all'ora send_time.
--        'on_complete'  → il report parte appena TUTTI i punti vendita hanno
--                         confermato la chiusura di oggi (o l'hanno segnata
--                         come giorno di chiusura); send_time diventa l'ORA
--                         LIMITE: se a quell'ora manca ancora qualcuno, parte
--                         lo stesso con i mancanti in evidenza.
--      daily_report_settings.followup_enabled
--        → una chiusura confermata DOPO l'invio del report del giorno genera
--          un'integrazione (mail + WhatsApp) con quel negozio e i totali
--          aggiornati (kind = 'followup' nel log, una per chiusura).
--   2. daily_report_dispatch(): un solo punto che inserisce la riga di log
--      'queued' e chiama la edge function via pg_net (usato dal tick e dal
--      trigger). L'URL della function e la anon key si leggono dal comando
--      del job pg_cron 'daily-cash-report-tick' (migration 176): nessun
--      valore di tenant nel codice.
--   3. Trigger AFTER su outlet_daily_closings: alla conferma di una chiusura
--      decide se far partire il report (completo, on_complete) o
--      l'integrazione (report già inviato). Non blocca mai la conferma:
--      ogni errore diventa un WARNING nel log di Postgres.
--   4. daily_cash_report_tick(): stessa firma; in modalità on_complete manda
--      all'ora limite (o prima, come rete di sicurezza, se il trigger non ha
--      potuto e la giornata è completa). Il sollecito in-app dice
--      «al più tardi alle» quando la modalità è a completamento.
--
-- Additiva: nuove colonne con default, nessun dato toccato, nessun DROP di
-- tabelle/colonne (solo ricreato un indice parziale di unicità del log).
-- Da applicare su NZ → Made → Zago.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 1. Impostazioni e log
-- ---------------------------------------------------------------------
ALTER TABLE public.daily_report_settings
  ADD COLUMN IF NOT EXISTS send_mode        text    NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS followup_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.daily_report_settings DROP CONSTRAINT IF EXISTS daily_report_settings_send_mode_check;
ALTER TABLE public.daily_report_settings ADD CONSTRAINT daily_report_settings_send_mode_check
  CHECK (send_mode IN ('fixed', 'on_complete'));
COMMENT ON COLUMN public.daily_report_settings.send_mode IS
  'fixed = parte all''ora send_time; on_complete = parte appena tutti i punti vendita hanno confermato, al più tardi alle send_time';
COMMENT ON COLUMN public.daily_report_settings.followup_enabled IS
  'Una chiusura confermata dopo l''invio del report del giorno genera un''integrazione (mail + WhatsApp)';

ALTER TABLE public.daily_report_log
  ADD COLUMN IF NOT EXISTS closing_id  uuid,
  ADD COLUMN IF NOT EXISTS outlet_name text;
ALTER TABLE public.daily_report_log DROP CONSTRAINT IF EXISTS daily_report_log_kind_check;
ALTER TABLE public.daily_report_log ADD CONSTRAINT daily_report_log_kind_check
  CHECK (kind IN ('report', 'reminder', 'test', 'followup'));
-- Un report e un sollecito al giorno; le integrazioni possono essere più di una.
DROP INDEX IF EXISTS public.daily_report_log_once_per_day;
CREATE UNIQUE INDEX daily_report_log_once_per_day
  ON public.daily_report_log (company_id, report_date, kind)
  WHERE status IN ('queued', 'sent') AND kind NOT IN ('test', 'followup');
CREATE INDEX IF NOT EXISTS daily_report_log_closing ON public.daily_report_log (closing_id) WHERE closing_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Endpoint della edge function (dal job pg_cron) e completezza del giorno
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.daily_report_endpoint(OUT function_url text, OUT anon_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, pg_temp
AS $$
DECLARE
  v_cmd text;
  v_m   text[];
BEGIN
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'daily-cash-report-tick' LIMIT 1;
  IF v_cmd IS NULL THEN RETURN; END IF;
  -- daily_cash_report_tick('https://<ref>.supabase.co/functions/v1/daily-cash-report-send', '<anon>')
  v_m := regexp_match(v_cmd, $re$daily_cash_report_tick\(\s*'([^']+)'\s*,\s*'([^']+)'$re$);
  IF v_m IS NOT NULL THEN
    function_url := v_m[1];
    anon_key     := v_m[2];
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.daily_report_endpoint() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daily_report_endpoint() TO service_role;

-- Vero quando ogni punto vendita attivo (non sede/magazzino) ha per quel giorno
-- una chiusura confermata o verificata (anche come «giorno di chiusura»).
CREATE OR REPLACE FUNCTION public.daily_report_is_complete(p_company_id uuid, p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM public.outlets o
     WHERE o.company_id = p_company_id AND COALESCE(o.is_active, true)
       AND lower(COALESCE(o.outlet_type, 'outlet')) NOT IN ('sede', 'magazzino', 'warehouse', 'hq', 'ufficio')
       AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                        WHERE c.outlet_id = o.id AND c.closing_date = p_date
                          AND c.status IN ('confermata', 'verificata'))
  ) AND EXISTS (
    SELECT 1 FROM public.outlets o
     WHERE o.company_id = p_company_id AND COALESCE(o.is_active, true)
       AND lower(COALESCE(o.outlet_type, 'outlet')) NOT IN ('sede', 'magazzino', 'warehouse', 'hq', 'ufficio')
  );
$$;
REVOKE ALL ON FUNCTION public.daily_report_is_complete(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daily_report_is_complete(uuid, date) TO service_role, authenticated;

-- ---------------------------------------------------------------------
-- 3. Invio: riga di log + chiamata alla edge function (report o integrazione)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.daily_report_dispatch(
  p_company_id  uuid,
  p_date        date,
  p_kind        text,           -- 'report' | 'followup'
  p_closing_id  uuid DEFAULT NULL,
  p_outlet_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, vault, pg_temp
AS $$
DECLARE
  v_secret  text;
  v_url     text;
  v_anon    text;
  s         record;
  v_log_id  uuid;
  v_request bigint;
BEGIN
  SELECT * INTO s FROM public.daily_report_settings WHERE company_id = p_company_id AND enabled;
  IF NOT FOUND OR cardinality(s.recipients) = 0 THEN RETURN NULL; END IF;
  SELECT decrypted_secret::text INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'autofix_cron_secret' LIMIT 1;
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'autofix_cron_secret assente nel vault: la edge function rifiuterebbe la chiamata';
  END IF;
  SELECT function_url, anon_key INTO v_url, v_anon FROM public.daily_report_endpoint();
  IF v_url IS NULL OR v_anon IS NULL THEN
    RAISE EXCEPTION 'job pg_cron daily-cash-report-tick non trovato: impossibile ricavare l''URL della edge function';
  END IF;

  -- Il report del giorno è unico (indice parziale); l'integrazione è una per chiusura.
  INSERT INTO public.daily_report_log (company_id, report_date, kind, status, recipients, closing_id, outlet_name)
  VALUES (p_company_id, p_date, p_kind, 'queued', s.recipients, p_closing_id, p_outlet_name)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_log_id;
  IF v_log_id IS NULL THEN RETURN NULL; END IF;

  SELECT net.http_post(
    url     := v_url,
    body    := jsonb_build_object('log_id', v_log_id, 'company_id', p_company_id,
                                  'report_date', p_date, 'kind', p_kind,
                                  'closing_id', p_closing_id, 'outlet_name', p_outlet_name),
    params  := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type',   'application/json',
                 'Authorization',  'Bearer ' || v_anon,
                 'apikey',         v_anon,
                 'x-autofix-cron', v_secret),
    timeout_milliseconds := 120000
  ) INTO v_request;
  UPDATE public.daily_report_log SET request_id = v_request WHERE id = v_log_id;
  RETURN v_log_id;
END;
$$;
REVOKE ALL ON FUNCTION public.daily_report_dispatch(uuid, date, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daily_report_dispatch(uuid, date, text, uuid, text) TO service_role;

-- ---------------------------------------------------------------------
-- 4. Trigger: alla conferma di una chiusura
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cash_closing_report_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s        record;
  v_today  date;
  v_name   text;
  v_sent   boolean;
BEGIN
  IF NEW.status NOT IN ('confermata', 'verificata') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('confermata', 'verificata') THEN RETURN NEW; END IF;

  BEGIN
    SELECT * INTO s FROM public.daily_report_settings WHERE company_id = NEW.company_id AND enabled;
    IF NOT FOUND THEN RETURN NEW; END IF;
    v_today := (now() AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Europe/Rome'))::date;
    SELECT name INTO v_name FROM public.outlets WHERE id = NEW.outlet_id;

    -- Report del giorno già inviato? Allora questa chiusura è arrivata dopo: integrazione.
    SELECT EXISTS (SELECT 1 FROM public.daily_report_log
                    WHERE company_id = NEW.company_id AND report_date = NEW.closing_date
                      AND kind = 'report' AND status = 'sent') INTO v_sent;
    IF v_sent THEN
      IF s.followup_enabled
         AND NOT EXISTS (SELECT 1 FROM public.daily_report_log
                          WHERE closing_id = NEW.id AND kind = 'followup'
                            AND status IN ('queued', 'sent') AND created_at > now() - interval '10 minutes') THEN
        PERFORM public.daily_report_dispatch(NEW.company_id, NEW.closing_date, 'followup', NEW.id, v_name);
      END IF;
      RETURN NEW;
    END IF;

    -- Report non ancora partito: in modalità a completamento parte se oggi è completo.
    IF s.send_mode = 'on_complete' AND NEW.closing_date = v_today
       AND public.daily_report_is_complete(NEW.company_id, NEW.closing_date) THEN
      PERFORM public.daily_report_dispatch(NEW.company_id, NEW.closing_date, 'report');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Mai bloccare la conferma della cassiera per un problema del report.
    RAISE WARNING '[daily-report] dispatch alla conferma della chiusura % non riuscito: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_closing_report_dispatch ON public.outlet_daily_closings;
CREATE TRIGGER trg_cash_closing_report_dispatch
  AFTER INSERT OR UPDATE OF status ON public.outlet_daily_closings
  FOR EACH ROW EXECUTE FUNCTION public.fn_cash_closing_report_dispatch();

-- ---------------------------------------------------------------------
-- 5. Il tick (ogni 15 minuti): ora fissa, ora limite, rete di sicurezza, sollecito
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
  s            record;
  v_local      timestamp;
  v_today      date;
  v_time       time;
  v_log_id     uuid;
  v_sent       integer := 0;
  v_reminded   integer := 0;
  v_missing    record;
  v_names      text[];
  v_pending    boolean;
  v_due        boolean;
BEGIN
  -- p_function_url / p_anon_key restano nella firma per il job pg_cron esistente:
  -- daily_report_dispatch() li rilegge da lì (daily_report_endpoint).
  FOR s IN SELECT * FROM public.daily_report_settings WHERE enabled LOOP
    v_local := now() AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Europe/Rome');
    v_today := v_local::date;
    v_time  := v_local::time;

    v_pending := NOT EXISTS (SELECT 1 FROM public.daily_report_log
                              WHERE company_id = s.company_id AND report_date = v_today
                                AND kind = 'report' AND status IN ('queued', 'sent'));
    IF cardinality(s.recipients) > 0 AND v_pending THEN
      -- Ora fissa / ora limite: finestra di 30 minuti (il cron gira ogni 15).
      v_due := v_time >= s.send_time AND v_time < s.send_time + interval '30 minutes';
      -- A completamento: rete di sicurezza se il trigger non ha potuto (mai prima delle 12,
      -- così una giornata «tutti chiusi» segnata al mattino non manda il report a mezzogiorno).
      IF NOT v_due AND s.send_mode = 'on_complete' AND v_time >= time '12:00'
         AND public.daily_report_is_complete(s.company_id, v_today) THEN
        v_due := true;
      END IF;
      IF v_due THEN
        v_log_id := public.daily_report_dispatch(s.company_id, v_today, 'report');
        IF v_log_id IS NOT NULL THEN v_sent := v_sent + 1; END IF;
      END IF;
    END IF;

    -- Sollecito in-app ai negozi che non hanno ancora confermato la chiusura di oggi.
    IF s.reminder_time IS NOT NULL
       AND v_time >= s.reminder_time AND v_time < s.reminder_time + interval '30 minutes'
       AND NOT EXISTS (SELECT 1 FROM public.daily_report_log
                        WHERE company_id = s.company_id AND report_date = v_today
                          AND kind = 'reminder' AND status IN ('queued', 'sent')) THEN
      v_names := '{}';
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
               CASE WHEN s.send_mode = 'on_complete'
                    THEN 'Il report serale parte appena tutti i negozi hanno confermato, al più tardi alle ' || to_char(s.send_time, 'HH24:MI')
                    ELSE 'Il report serale parte alle ' || to_char(s.send_time, 'HH24:MI') END
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

-- Verifica:
-- SELECT * FROM public.daily_report_endpoint();                       -- url e anon key dal job
-- SELECT public.daily_report_is_complete('<company_id>', current_date);
-- SELECT send_mode, send_time, followup_enabled FROM public.daily_report_settings;
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.outlet_daily_closings'::regclass AND NOT tgisinternal;
