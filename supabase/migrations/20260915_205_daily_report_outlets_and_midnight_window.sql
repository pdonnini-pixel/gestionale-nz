-- =====================================================================
-- 205 — Report incassi: quali punti vendita contano, e finestra oltre la mezzanotte
--
-- Il 14/09/2026 il report non è partito. Due cause:
--   1. Un punto vendita appena creato in anagrafica (in apertura, senza
--      operatori cassa né chiusure) contava come «da attendere»:
--      daily_report_is_complete() restava falsa anche con i 7 negozi
--      confermati, quindi il trigger a completamento non ha mai inviato.
--   2. L'ora limite 23:30 non ha funzionato: la finestra del tick era
--      calcolata su un tipo time, e time '23:30' + 30 minuti torna a
--      00:00 (il time gira su 24 ore). La condizione «prima della fine
--      della finestra» era sempre falsa dopo le 23:30.
--
-- Fix:
--   - daily_report_outlets(company): i punti vendita che partecipano alle
--     chiusure = attivi, non sede/magazzino, e con almeno un operatore
--     cassa assegnato oppure una chiusura negli ultimi 60 giorni. Usata da
--     daily_report_is_complete(), dal tick (sollecito) e dalla edge function
--     (righe del report), così le tre viste concordano.
--   - daily_cash_report_tick(): finestre calcolate su timestamp locali
--     (data + ora), non su time.
-- Additiva. Da applicare su NZ → Made → Zago.
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.daily_report_outlets(p_company_id uuid)
RETURNS TABLE(outlet_id uuid, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.id, o.name
    FROM public.outlets o
   WHERE o.company_id = p_company_id AND COALESCE(o.is_active, true)
     AND lower(COALESCE(o.outlet_type, 'outlet')) NOT IN ('sede', 'magazzino', 'warehouse', 'hq', 'ufficio')
     AND (
       EXISTS (SELECT 1 FROM public.user_outlet_access uoa
                 JOIN public.user_profiles up ON up.id = uoa.user_id
                WHERE uoa.outlet_id = o.id AND up.role::text = 'operatore_cassa' AND COALESCE(up.is_active, true))
       OR EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                   WHERE c.outlet_id = o.id AND c.closing_date >= current_date - 60)
     )
   ORDER BY o.name;
$$;
REVOKE ALL ON FUNCTION public.daily_report_outlets(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daily_report_outlets(uuid) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.daily_report_is_complete(p_company_id uuid, p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.daily_report_outlets(p_company_id))
     AND NOT EXISTS (
       SELECT 1 FROM public.daily_report_outlets(p_company_id) o
        WHERE NOT EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                           WHERE c.outlet_id = o.outlet_id AND c.closing_date = p_date
                             AND c.status IN ('confermata', 'verificata')));
$$;

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
  v_send_at    timestamp;
  v_remind_at  timestamp;
  v_log_id     uuid;
  v_sent       integer := 0;
  v_reminded   integer := 0;
  v_missing    record;
  v_names      text[];
  v_pending    boolean;
  v_due        boolean;
BEGIN
  FOR s IN SELECT * FROM public.daily_report_settings WHERE enabled LOOP
    v_local := now() AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Europe/Rome');
    v_today := v_local::date;
    -- Finestre su timestamp (data + ora): un'ora limite vicino alla mezzanotte non «gira» su 00:00.
    v_send_at := v_today + s.send_time;

    v_pending := NOT EXISTS (SELECT 1 FROM public.daily_report_log
                              WHERE company_id = s.company_id AND report_date = v_today
                                AND kind = 'report' AND status IN ('queued', 'sent'));
    IF cardinality(s.recipients) > 0 AND v_pending THEN
      v_due := v_local >= v_send_at AND v_local < v_send_at + interval '30 minutes';
      IF NOT v_due AND s.send_mode = 'on_complete' AND v_local >= v_today + time '12:00'
         AND public.daily_report_is_complete(s.company_id, v_today) THEN
        v_due := true;
      END IF;
      IF v_due THEN
        v_log_id := public.daily_report_dispatch(s.company_id, v_today, 'report');
        IF v_log_id IS NOT NULL THEN v_sent := v_sent + 1; END IF;
      END IF;
    END IF;

    IF s.reminder_time IS NOT NULL THEN
      v_remind_at := v_today + s.reminder_time;
      IF v_local >= v_remind_at AND v_local < v_remind_at + interval '30 minutes'
         AND NOT EXISTS (SELECT 1 FROM public.daily_report_log
                          WHERE company_id = s.company_id AND report_date = v_today
                            AND kind = 'reminder' AND status IN ('queued', 'sent')) THEN
        v_names := '{}';
        FOR v_missing IN
          SELECT o.outlet_id AS id, o.name
            FROM public.daily_report_outlets(s.company_id) o
           WHERE NOT EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                              WHERE c.outlet_id = o.outlet_id AND c.closing_date = v_today
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
    END IF;
  END LOOP;

  RETURN jsonb_build_object('reports', v_sent, 'reminders', v_reminded, 'at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.daily_cash_report_tick(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daily_cash_report_tick(text, text) TO service_role;

COMMIT;

-- Verifica:
-- SELECT * FROM public.daily_report_outlets('<company_id>');
-- SELECT public.daily_report_is_complete('<company_id>', current_date - 1);
