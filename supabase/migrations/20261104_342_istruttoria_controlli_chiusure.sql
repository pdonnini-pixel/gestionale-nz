-- 20261104_342_istruttoria_controlli_chiusure.sql
--
-- «Da controllare» non deve essere una lista che qualcuno legge la mattina:
-- il gestionale prende in carico ogni segnalazione, cerca la prova nei dati
-- che ha già, sistema quello che può e dice il resto in chiaro.
--
-- Nasce dal report del 3 novembre 2026, quattro righe da controllare:
--   - BRUGNATO ×2: versamento scritto 3.755,00 contro 1.270,00 e 2.485,00
--     delle due ricevute. Somma 3.755,00: il campo era giusto, il controllo
--     confrontava ogni foto da sola. Due segnalazioni, zero problemi.
--   - PALMANOVA: ammanco di 75,84 EUR, con la nota della cassiera che diceva
--     quale fattura era. Trovata nei fornitori (RICA GEST 2540312521 del
--     28/10, MP01 contanti): unica segnalazione vera del mese.
-- Misura su 30 giorni e 210 giornate: 9 differenze di cassa, di cui 8 da 10 a
-- 50 centesimi che si compensano fra giorni vicini, 13 note della cassiera
-- segnalate sempre, 20 giornate con più foto dello stesso tipo.
--
-- Qui si creano:
--   1. closing_checks       una riga per segnalazione, con prova ed esito
--   2. closing_check_runs   un giro di istruttoria per azienda e giorno
--   3. le impostazioni      destinatari, tolleranza, messaggi ai negozi
--   4. il dispatch e il cron che chiamano la edge function closing-checks-run
--
-- Niente di distruttivo: tabelle nuove, colonne nuove con default.

BEGIN;

-- ── 1. Le segnalazioni ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.closing_checks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id),
  outlet_id     uuid REFERENCES public.outlets(id),
  closing_id    uuid REFERENCES public.outlet_daily_closings(id) ON DELETE CASCADE,
  closing_date  date NOT NULL,
  -- che tipo di segnalazione è
  kind          text NOT NULL CHECK (kind = ANY (ARRAY[
                  'differenza_cassa', 'differenza_corrispettivi', 'foto_diversa',
                  'foto_mancante', 'bozza', 'nota'])),
  amount        numeric(14,2),
  -- la frase che oggi finiva nel report, per capire di cosa si parla
  detail        text NOT NULL,
  -- come è finita
  outcome       text NOT NULL DEFAULT 'da_fare' CHECK (outcome = ANY (ARRAY[
                  'falso_allarme', 'sistemato', 'da_fare', 'informazione'])),
  -- perché: la prova trovata nei dati (le due ricevute, la fattura, il giorno
  -- che compensa). Sempre scritta: un esito senza prova non vale niente.
  reason        text,
  -- cosa ha scritto il gestionale, quando ha sistemato
  action        text,
  undo_kind     text CHECK (undo_kind IS NULL OR undo_kind = ANY (ARRAY['expense_row', 'fields'])),
  undo_data     jsonb,
  undone_at     timestamptz,
  undone_by     uuid,
  -- il messaggio al negozio
  message_to    text,
  message_text  text,
  message_sent_at timestamptz,
  message_error text,
  -- chi ha chiuso la segnalazione: NULL = il gestionale
  resolved_at   timestamptz,
  resolved_by   uuid,
  -- impronta per non duplicare la stessa segnalazione a ogni giro
  fingerprint   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (closing_id, kind, fingerprint)
);

CREATE INDEX IF NOT EXISTS closing_checks_company_date_idx
  ON public.closing_checks (company_id, closing_date DESC);
CREATE INDEX IF NOT EXISTS closing_checks_outcome_idx
  ON public.closing_checks (company_id, outcome, closing_date DESC);

ALTER TABLE public.closing_checks ENABLE ROW LEVEL SECURITY;

-- Chi lavora in azienda legge le segnalazioni della propria azienda; chi sta
-- in negozio vede solo i propri outlet. Scrive solo chi amministra (il
-- gestionale passa dal service_role).
CREATE POLICY closing_checks_select ON public.closing_checks
  FOR SELECT TO authenticated
  USING (company_id = (SELECT get_my_company_id())
         AND (outlet_id IS NULL OR (SELECT get_my_role()) <> 'operatore_cassa'
              OR EXISTS (SELECT 1 FROM public.user_outlet_access uoa
                          WHERE uoa.user_id = (SELECT auth.uid()) AND uoa.outlet_id = closing_checks.outlet_id)));

CREATE POLICY closing_checks_update ON public.closing_checks
  FOR UPDATE TO authenticated
  USING (company_id = (SELECT get_my_company_id())
         AND (SELECT get_my_role()) IN ('super_advisor', 'contabile'))
  WITH CHECK (company_id = (SELECT get_my_company_id()));

GRANT SELECT, UPDATE ON public.closing_checks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.closing_checks TO service_role;

COMMENT ON TABLE public.closing_checks IS
  'Segnalazioni delle chiusure di cassa prese in carico dal gestionale: una riga per segnalazione, con la prova trovata, l''esito (falso allarme, sistemato, da fare, informazione), cosa è stato scritto e come annullarlo, più il messaggio mandato al negozio. Migrazione 342.';

-- ── 2. Il giro di istruttoria ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.closing_check_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id),
  run_date     date NOT NULL,
  status       text NOT NULL DEFAULT 'queued' CHECK (status = ANY (ARRAY['queued', 'done', 'error'])),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  summary      jsonb,
  error        text,
  request_id   bigint,
  mail_sent_at timestamptz,
  recipients   text[] NOT NULL DEFAULT '{}',
  UNIQUE (company_id, run_date)
);

ALTER TABLE public.closing_check_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY closing_check_runs_select ON public.closing_check_runs
  FOR SELECT TO authenticated
  USING (company_id = (SELECT get_my_company_id()));

GRANT SELECT ON public.closing_check_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.closing_check_runs TO service_role;

COMMENT ON TABLE public.closing_check_runs IS
  'Un giro di istruttoria dei controlli per azienda e giorno: quando è partito, com''è finito, il riepilogo e quando è stata mandata la mail di esito. Migrazione 342.';

-- ── 3. Impostazioni ─────────────────────────────────────────────────────
ALTER TABLE public.daily_report_settings
  ADD COLUMN IF NOT EXISTS checks_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS checks_recipients text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS checks_store_messages boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS checks_tolerance numeric(14,2) NOT NULL DEFAULT 1.00;

COMMENT ON COLUMN public.daily_report_settings.checks_recipients IS
  'Chi riceve la mail con l''esito dei controlli (di norma chi guida e l''amministrazione). Vuoto = nessuna mail di esito.';
COMMENT ON COLUMN public.daily_report_settings.checks_store_messages IS
  'Se vero, il gestionale scrive anche al singolo negozio (indirizzo in anagrafica outlet) quando c''è qualcosa da imparare; le risposte tornano all''amministrazione.';
COMMENT ON COLUMN public.daily_report_settings.checks_tolerance IS
  'Sotto questa cifra una differenza di cassa è un arrotondamento e non si segnala a nessuno (deciso da Patrizio il 04/11/2026: 1,00 EUR).';

-- ── 4. Dispatch e cron ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.closing_checks_dispatch(p_company_id uuid, p_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net', 'vault', 'pg_temp'
AS $function$
DECLARE
  v_secret  text;
  v_url     text;
  v_anon    text;
  s         record;
  v_run_id  uuid;
  v_request bigint;
BEGIN
  SELECT * INTO s FROM public.daily_report_settings WHERE company_id = p_company_id AND enabled AND checks_enabled;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT decrypted_secret::text INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'autofix_cron_secret' LIMIT 1;
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'autofix_cron_secret assente nel vault: la edge function rifiuterebbe la chiamata';
  END IF;

  SELECT replace(function_url, 'daily-cash-report-send', 'closing-checks-run'), anon_key
    INTO v_url, v_anon FROM public.daily_report_endpoint();
  IF v_url IS NULL OR v_anon IS NULL THEN
    RAISE EXCEPTION 'job pg_cron daily-cash-report-tick non trovato: impossibile ricavare l''URL della edge function';
  END IF;

  INSERT INTO public.closing_check_runs (company_id, run_date, status, recipients)
  VALUES (p_company_id, p_date, 'queued', s.checks_recipients)
  ON CONFLICT (company_id, run_date) DO NOTHING
  RETURNING id INTO v_run_id;
  IF v_run_id IS NULL THEN RETURN NULL; END IF;

  SELECT net.http_post(
    url     := v_url,
    body    := jsonb_build_object('run_id', v_run_id, 'company_id', p_company_id, 'closing_date', p_date),
    params  := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type',   'application/json',
                 'Authorization',  'Bearer ' || v_anon,
                 'apikey',         v_anon,
                 'x-autofix-cron', v_secret),
    timeout_milliseconds := 180000
  ) INTO v_request;
  UPDATE public.closing_check_runs SET request_id = v_request WHERE id = v_run_id;
  RETURN v_run_id;
END;
$function$;

-- Il giro parte quando il report serale è andato (così l'istruttoria lavora
-- sulle stesse righe che il report ha elencato) e, per sicurezza, la mattina
-- dopo per il giorno prima: le foto lette in ritardo e le chiusure tardive
-- entrano comunque.
CREATE OR REPLACE FUNCTION public.closing_checks_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  s        record;
  v_local  timestamp;
  v_today  date;
  v_run    uuid;
  v_n      integer := 0;
BEGIN
  FOR s IN SELECT * FROM public.daily_report_settings WHERE enabled AND checks_enabled LOOP
    v_local := now() AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Europe/Rome');
    v_today := v_local::date;

    -- oggi, appena il report serale è stato mandato
    IF EXISTS (SELECT 1 FROM public.daily_report_log
                WHERE company_id = s.company_id AND report_date = v_today
                  AND kind = 'report' AND status = 'sent') THEN
      v_run := public.closing_checks_dispatch(s.company_id, v_today);
      IF v_run IS NOT NULL THEN v_n := v_n + 1; END IF;
    END IF;

    -- ieri, dalle 8 del mattino, se nessuno ci ha ancora guardato
    IF v_local::time >= time '08:00' THEN
      v_run := public.closing_checks_dispatch(s.company_id, v_today - 1);
      IF v_run IS NOT NULL THEN v_n := v_n + 1; END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('runs', v_n, 'at', now());
END;
$function$;

GRANT EXECUTE ON FUNCTION public.closing_checks_dispatch(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.closing_checks_tick() TO service_role;

COMMIT;

-- Il cron sta fuori dalla transazione
SELECT cron.schedule('closing-checks-tick', '*/20 * * * *',
  $cron$SELECT public.closing_checks_tick();$cron$);

-- Verifica, su ogni tenant:
-- SELECT has_table_privilege('authenticated','public.closing_checks','select') AS auth,
--        has_table_privilege('service_role','public.closing_checks','insert') AS srv;
-- SELECT jobname, schedule FROM cron.job WHERE jobname = 'closing-checks-tick';
