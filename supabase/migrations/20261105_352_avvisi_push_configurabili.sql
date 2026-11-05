-- =====================================================================
-- Migrazione 352 — Avvisi sul telefono (app New Zago), configurabili
-- =====================================================================
-- PERCHE': Patrizio (05/11/2026): niente WhatsApp, notifiche push dell'app
-- New Zago (Android e iOS, pubblicata con gli account EPPI). Due avvisi:
--   - RITARDO: il turno e' cominciato da 15 minuti e l'entrata non c'e';
--   - USCITA NON TIMBRATA: fine turno + 30 minuti e risulta ancora dentro.
-- Li ricevono il dipendente e il responsabile del negozio (il referente,
-- outlets.referente_employee_id). Tutto si configura per negozio in
-- Dipendenti → Presenze: «voglio una sezione dove posso configurare».
--
-- COSA INTRODUCE:
--   1. attendance_settings: interruttore degli avvisi, minuti e destinatari
--   2. employee_push_tokens: i telefoni su cui arrivano le notifiche
--   3. attendance_alerts: gli avvisi mandati (uno per turno, tipo e destinatario)
--   4. timbrature_avvisi_da_mandare(): chi avvisare adesso
--   5. il cron passa alla Edge Function timbrature-notifiche, ogni 5 minuti
-- WhatsApp: le colonne e la tabella della 348 restano (nessun dato si
-- cancella), ma non le usa piu' nessuno. attendance_notifications ha 0 righe.
--
-- NO DATA LOSS: solo ADD COLUMN, CREATE TABLE, CREATE OR REPLACE FUNCTION.
-- REGOLA #0 (dal 03/11/2026): NZ e Zago. APPLICATA il 05/11/2026 su NZ e Zago (funzioni identiche, md5).
-- =====================================================================

-- 1. Impostazioni per negozio
ALTER TABLE public.attendance_settings
  ADD COLUMN IF NOT EXISTS avvisi_push         boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ritardo_attivo      boolean  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ritardo_minuti      smallint NOT NULL DEFAULT 15 CHECK (ritardo_minuti BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS uscita_attivo       boolean  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS avvisa_dipendente   boolean  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS avvisa_responsabile boolean  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS avvisa_ufficio      boolean  NOT NULL DEFAULT false;
COMMENT ON COLUMN public.attendance_settings.avvisi_push IS 'Avvisi sul telefono (app New Zago) accesi per questo negozio.';
COMMENT ON COLUMN public.attendance_settings.ritardo_minuti IS 'Minuti dopo l''inizio del turno senza entrata prima dell''avviso di ritardo (15 di partenza).';
COMMENT ON COLUMN public.attendance_settings.avvisa_ufficio IS 'Anche una notifica nel gestionale per chi segue il personale.';
COMMENT ON COLUMN public.attendance_settings.avvisi_whatsapp IS 'Non usata dal 05/11/2026: WhatsApp tolto, si usano le notifiche dell''app (migration 352).';

-- 2. Telefoni per le notifiche
CREATE TABLE IF NOT EXISTS public.employee_push_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id),
  employee_id   uuid NOT NULL REFERENCES public.employees(id),
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  token         text NOT NULL UNIQUE,
  piattaforma   text NOT NULL CHECK (piattaforma IN ('android', 'ios')),
  attivo        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  aggiornato_il timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_push_tokens_emp_idx ON public.employee_push_tokens (employee_id) WHERE attivo;
COMMENT ON TABLE public.employee_push_tokens IS
  'Telefoni con l''app New Zago su cui mandare le notifiche. Scritta solo da app_registra_push_token, letta solo dalla Edge Function (service role).';
ALTER TABLE public.employee_push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_push_tokens FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.employee_push_tokens TO service_role;

CREATE OR REPLACE FUNCTION public.app_registra_push_token(p_token text, p_piattaforma text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_emp  uuid := public.timbrature_mio_dipendente();
  v_comp uuid;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Accesso non collegato a un dipendente' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_piattaforma, '') NOT IN ('android', 'ios') OR length(COALESCE(p_token, '')) NOT BETWEEN 20 AND 4096 THEN
    RAISE EXCEPTION 'Telefono non valido' USING ERRCODE = '22023';
  END IF;
  SELECT company_id INTO v_comp FROM public.employees WHERE id = v_emp;
  -- Lo stesso telefono passato a un'altra persona: il token segue chi lo usa ora
  INSERT INTO public.employee_push_tokens (company_id, employee_id, user_id, token, piattaforma)
  VALUES (v_comp, v_emp, (SELECT auth.uid()), p_token, p_piattaforma)
  ON CONFLICT (token) DO UPDATE
     SET company_id = EXCLUDED.company_id, employee_id = EXCLUDED.employee_id, user_id = EXCLUDED.user_id,
         piattaforma = EXCLUDED.piattaforma, attivo = true, aggiornato_il = now();
END;
$$;
REVOKE ALL ON FUNCTION public.app_registra_push_token(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_registra_push_token(text, text) TO authenticated;

-- Per la pagina Presenze: chi ha l'app con le notifiche attive
CREATE OR REPLACE FUNCTION public.app_push_stato(p_outlet_id uuid)
RETURNS TABLE (employee_id uuid, piattaforme text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.employee_id, string_agg(DISTINCT t.piattaforma, ', ')
    FROM public.employee_push_tokens t JOIN public.employees e ON e.id = t.employee_id
   WHERE t.attivo AND e.outlet_id = p_outlet_id AND e.company_id = (SELECT public.get_my_company_id())
   GROUP BY t.employee_id;
END;
$$;
REVOKE ALL ON FUNCTION public.app_push_stato(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_push_stato(uuid) TO authenticated;

-- 3. Avvisi mandati
CREATE TABLE IF NOT EXISTS public.attendance_alerts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES public.companies(id),
  outlet_id               uuid NOT NULL REFERENCES public.outlets(id),
  employee_id             uuid NOT NULL REFERENCES public.employees(id),
  shift_id                uuid REFERENCES public.shifts(id) ON DELETE SET NULL,
  data                    date NOT NULL,
  ora_turno               time NOT NULL,
  tipo                    text NOT NULL CHECK (tipo IN ('ritardo', 'uscita_mancante')),
  destinatario            text NOT NULL CHECK (destinatario IN ('dipendente', 'responsabile', 'ufficio')),
  destinatario_employee_id uuid REFERENCES public.employees(id),
  telefoni                smallint NOT NULL DEFAULT 0,
  esito                   text NOT NULL CHECK (esito IN ('mandato', 'nessun_telefono', 'non_riuscito', 'nel_gestionale')),
  errore                  text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, data, ora_turno, tipo, destinatario)
);
CREATE INDEX IF NOT EXISTS attendance_alerts_outlet_data_idx ON public.attendance_alerts (company_id, outlet_id, data);
COMMENT ON TABLE public.attendance_alerts IS
  'Avvisi di ritardo e di uscita non timbrata: uno per turno, tipo e destinatario. Un avviso registrato non si rimanda.';
ALTER TABLE public.attendance_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_alerts_select ON public.attendance_alerts
  FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.timbrature_gestore()));
CREATE POLICY cash_operator_block ON public.attendance_alerts AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
CREATE POLICY dipendente_block ON public.attendance_alerts AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');
REVOKE ALL ON public.attendance_alerts FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.attendance_alerts FROM authenticated;
GRANT SELECT ON public.attendance_alerts TO authenticated;
GRANT SELECT, INSERT ON public.attendance_alerts TO service_role;

-- 4. Chi avvisare adesso
--   RITARDO: turno di oggi cominciato da almeno ritardo_minuti (e da meno di
--   3 ore), la persona e' «fuori» (nessuna timbratura oggi, oppure l'ultima e'
--   un'uscita: turno spezzato), non ha ferie o permessi quel giorno.
--   USCITA: turno finito da almeno margine_uscita_minuti (e da meno di 12
--   ore), la persona risulta dentro, e' l'ultimo turno della sua giornata.
CREATE OR REPLACE FUNCTION public.timbrature_avvisi_da_mandare(p_now timestamptz DEFAULT now())
RETURNS TABLE (company_id uuid, outlet_id uuid, employee_id uuid, shift_id uuid, data date, ora_turno time,
               tipo text, nome text, negozio text, responsabile_id uuid,
               avvisa_dipendente boolean, avvisa_responsabile boolean, avvisa_ufficio boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH oggi AS (SELECT (p_now AT TIME ZONE 'Europe/Rome')::date AS d),
  negozi AS (
    SELECT a.* FROM public.attendance_settings a WHERE a.attive AND a.avvisi_push
  ),
  turni AS (
    SELECT t.*, n.company_id AS cid, n.ritardo_attivo, n.ritardo_minuti, n.uscita_attivo, n.margine_uscita_minuti,
           n.avvisa_dipendente AS a_dip, n.avvisa_responsabile AS a_resp, n.avvisa_ufficio AS a_uff,
           ((t.data + t.inizio) AT TIME ZONE 'Europe/Rome') AS inizio_ts,
           ((t.data + t.fine)   AT TIME ZONE 'Europe/Rome') AS fine_ts
      FROM negozi n, oggi,
           LATERAL public.timbrature_turni_ufficiali(n.company_id, oggi.d - 1, oggi.d) t
     WHERE t.outlet_id = n.outlet_id
  ),
  stato AS (
    SELECT t.*,
           (SELECT a.tipo FROM public.attendance_punches a
             WHERE a.employee_id = t.employee_id AND NOT a.annullata
               AND a.ora >= (t.data::timestamp AT TIME ZONE 'Europe/Rome') AND a.ora <= p_now
             ORDER BY a.ora DESC LIMIT 1) AS ultima
      FROM turni t
  ),
  candidati AS (
    SELECT s.*, 'ritardo'::text AS tipo_avviso, s.inizio AS ora
      FROM stato s
     WHERE s.ritardo_attivo
       AND s.inizio_ts + make_interval(mins => s.ritardo_minuti) <= p_now
       AND s.inizio_ts >= p_now - interval '3 hours'
       AND COALESCE(s.ultima, 'uscita') = 'uscita'
       AND NOT EXISTS (SELECT 1 FROM public.leave_request_days d JOIN public.leave_requests q ON q.id = d.request_id
                        WHERE q.employee_id = s.employee_id AND d.data = s.data
                          AND q.stato IN ('inviata', 'approvata', 'approvata_parziale', 'chiusa')
                          AND d.stato IN ('richiesto', 'approvato'))
    UNION ALL
    SELECT s.*, 'uscita_mancante'::text, s.fine
      FROM stato s
     WHERE s.uscita_attivo
       AND s.fine_ts + make_interval(mins => s.margine_uscita_minuti) <= p_now
       AND s.fine_ts >= p_now - interval '12 hours'
       AND s.ultima IN ('entrata', 'inizio_pausa', 'fine_pausa')
       AND NOT EXISTS (SELECT 1 FROM public.timbrature_turni_ufficiali(s.cid, s.data, s.data) t2
                        WHERE t2.employee_id = s.employee_id AND t2.shift_id <> s.shift_id AND t2.inizio >= s.fine)
  )
  SELECT c.cid, c.outlet_id, c.employee_id, c.shift_id, c.data, c.ora, c.tipo_avviso,
         trim(COALESCE(e.nome, e.first_name, '') || ' ' || COALESCE(e.cognome, e.last_name, '')), o.name,
         o.referente_employee_id, c.a_dip, c.a_resp, c.a_uff
    FROM candidati c
    JOIN public.employees e ON e.id = c.employee_id AND COALESCE(e.is_active, true)
    JOIN public.outlets o ON o.id = c.outlet_id
   WHERE NOT EXISTS (SELECT 1 FROM public.attendance_alerts x
                      WHERE x.employee_id = c.employee_id AND x.data = c.data
                        AND x.ora_turno = c.ora AND x.tipo = c.tipo_avviso);
$$;
REVOKE ALL ON FUNCTION public.timbrature_avvisi_da_mandare(timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timbrature_avvisi_da_mandare(timestamptz) TO service_role;

-- Account di servizio Firebase (JSON) per mandare le notifiche: lo inserisce
-- Patrizio nel Vault con il nome fcm_service_account. Lo legge solo la Edge
-- Function, mai il browser.
CREATE OR REPLACE FUNCTION public.get_fcm_service_account()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
  SELECT decrypted_secret::text FROM vault.decrypted_secrets WHERE name = 'fcm_service_account' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_fcm_service_account() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_fcm_service_account() TO service_role;

-- 5. Il cron chiama timbrature-notifiche (prima: timbrature-avvisi, WhatsApp)
CREATE OR REPLACE FUNCTION public.timbrature_avvisi_tick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'net', 'vault', 'pg_temp'
AS $function$
DECLARE
  v_secret  text;
  v_url     text;
  v_anon    text;
  v_request bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.timbrature_avvisi_da_mandare(now())) THEN
    RETURN NULL;
  END IF;
  SELECT decrypted_secret::text INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'autofix_cron_secret' LIMIT 1;
  SELECT replace(function_url, 'daily-cash-report-send', 'timbrature-notifiche'), anon_key
    INTO v_url, v_anon FROM public.daily_report_endpoint();
  IF v_secret IS NULL OR v_url IS NULL OR v_anon IS NULL THEN
    RAISE NOTICE 'timbrature_avvisi_tick: segreto o endpoint mancante, nessun invio';
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url     := v_url,
    body    := jsonb_build_object('at', now()),
    params  := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon,
                                  'apikey', v_anon, 'x-autofix-cron', v_secret),
    timeout_milliseconds := 60000
  ) INTO v_request;
  RETURN v_request;
END;
$function$;
REVOKE ALL ON FUNCTION public.timbrature_avvisi_tick() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timbrature_avvisi_tick() TO service_role;

-- Ogni 5 minuti (stesso nome: pg_cron aggiorna il job esistente)
SELECT cron.schedule('timbrature-avvisi-tick', '*/5 * * * *', $cron$SELECT public.timbrature_avvisi_tick();$cron$);
