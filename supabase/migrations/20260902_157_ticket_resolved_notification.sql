-- =====================================================================
-- Migrazione 157 — Avvisa l'autore quando la sua segnalazione è risolta
-- =====================================================================
-- PERCHE': il badge "Segnalazioni" ora conta solo i ticket APERTI (vedi
-- Layout.tsx). Un ticket che passa a 'risolto' spegne quindi il badge, e senza
-- questa migrazione nessuno avvisa più l'autore che la sua segnalazione è
-- stata sistemata: AutoFix scrive il commento sul ticket e cambia stato, punto.
--
-- PERCHE' UN TRIGGER E NON IL FRONTEND: un ticket può passare a 'risolto' da
-- quattro strade diverse (bottone in Ticket.tsx, bottone admin in
-- TicketAdmin.tsx, edge function ticket-resolve-now chiamata dal cron orario,
-- task AutoFix che aggiorna via SQL). Un solo trigger sulla tabella le copre
-- tutte e quattro.
--
-- COSA INTRODUCE:
--   * notifications.emailed_at — quando la notifica è stata passata alla
--     edge function per la mail (NULL = ancora da inviare).
--   * public.notify_ticket_resolved() + trigger trg_notify_ticket_resolved —
--     crea UNA notifica in-app per l'autore quando stato diventa 'risolto'.
--   * public.ticket_notifications_send_pending(url, key) — passa alla edge
--     function `ticket-notify-resolved` le notifiche ticket senza mail.
--   * cron ogni 10 minuti (schedulazione per tenant, in fondo al file).
--
-- LA NOTIFICA LA VEDE SOLO L'AUTORE: la policy RLS di notifications è
--   notifications_select: company_id = get_my_company_id()
--                         AND (user_id = auth.uid() OR user_id IS NULL)
-- quindi una riga con user_id valorizzato è visibile solo al destinatario.
-- La campanella (NotificationBell.tsx) non va toccata.
--
-- IL TRIGGER NON PUO' FAR FALLIRE LA RISOLUZIONE: tutto il corpo sta dentro
-- un blocco con EXCEPTION WHEN OTHERS THEN RETURN NEW. Se il profilo autore
-- non esiste, o la notifica non entra, il ticket si chiude lo stesso.
--
-- NO DATA LOSS: migrazione additiva (1 ADD COLUMN IF NOT EXISTS + 2 funzioni
-- + 1 trigger). Nessun DELETE, nessun DROP di dati, nessuna colonna toccata.
--
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago (3 project_id).
--
-- ⚠️ LA SCHEDULAZIONE E' PER TENANT (url e anon key cambiano): il
-- cron.schedule sta fuori dalla transazione, in fondo al file.
--
-- ⚠️ SEGRETI: url, anon key e segreto condiviso NON stanno dentro le funzioni
-- né in tabelle applicative (system_deploy_config è leggibile da qualsiasi
-- utente autenticato del tenant). L'url e la anon key arrivano come argomenti
-- del job cron; il segreto che autorizza davvero la chiamata è
-- 'autofix_cron_secret' nel vault, già presente sui tre tenant dalla
-- migrazione 156 e letto qui con la stessa RPC get_autofix_cron_secret().
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Traccia dell'invio email
-- ---------------------------------------------------------------------
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS emailed_at timestamptz;

COMMENT ON COLUMN public.notifications.emailed_at IS
  'Quando la notifica è stata passata alla edge function per la mail. NULL = non ancora inviata.';

-- ---------------------------------------------------------------------
-- 2. Notifica in-app alla risoluzione del ticket
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_ticket_resolved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, extensions
AS $$
DECLARE
  v_company_id uuid;
  v_last_ai    text;
  v_message    text;
BEGIN
  -- company_id e destinatario dal profilo dell'autore: tickets non ha
  -- company_id, e notifications.company_id è NOT NULL.
  SELECT up.company_id INTO v_company_id
    FROM public.user_profiles up
   WHERE up.id = NEW.autore_id
   LIMIT 1;

  -- Profilo assente (o senza azienda): usciamo senza fare nulla e senza
  -- sollevare eccezioni — la risoluzione del ticket non deve fallire.
  IF v_company_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Dedup: una sola notifica per ticket, per sempre. Riaprire e richiudere
  -- la stessa segnalazione non ne genera una seconda.
  IF EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.reference_type = 'ticket'
           AND n.reference_id   = NEW.id
     ) THEN
    RETURN NEW;
  END IF;

  -- Ultimo commento AI, se c'è: è la spiegazione di cosa è stato fatto.
  -- NB: i commenti AutoFix hanno autore='AutoFix' e origine='ai' (vedi
  -- supabase/functions/ticket-resolve-now/index.ts): filtriamo su origine,
  -- che è il campo stabile.
  SELECT left(c.value->>'testo', 300) INTO v_last_ai
    FROM jsonb_array_elements(COALESCE(NEW.commenti, '[]'::jsonb)) AS c(value)
   WHERE c.value->>'origine' = 'ai'
     AND COALESCE(c.value->>'testo', '') <> ''
   ORDER BY c.value->>'creato_il' DESC NULLS LAST
   LIMIT 1;

  v_message := COALESCE(NEW.titolo, 'La tua segnalazione');
  IF v_last_ai IS NOT NULL THEN
    v_message := v_message || ' — ' || v_last_ai;
  END IF;

  INSERT INTO public.notifications
    (company_id, user_id, title, message, category, severity,
     action_url, action_label, reference_type, reference_id)
  VALUES
    (v_company_id, NEW.autore_id, 'Segnalazione risolta', v_message,
     'ticket', 'info',
     '/ticket/' || NEW.id, 'Apri la segnalazione', 'ticket', NEW.id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Un trigger che fallisce bloccherebbe l'UPDATE del ticket: qualunque
  -- errore qui dentro viene ingoiato (rimane nei log del DB).
  RAISE WARNING 'notify_ticket_resolved(%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_ticket_resolved() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_ticket_resolved() FROM anon;

DROP TRIGGER IF EXISTS trg_notify_ticket_resolved ON public.tickets;
CREATE TRIGGER trg_notify_ticket_resolved
AFTER UPDATE ON public.tickets
FOR EACH ROW
WHEN (OLD.stato IS DISTINCT FROM NEW.stato AND NEW.stato = 'risolto')
EXECUTE FUNCTION public.notify_ticket_resolved();

-- ---------------------------------------------------------------------
-- 3. Invio mail delle notifiche ticket ancora da spedire
-- ---------------------------------------------------------------------
-- p_url = url della edge function ticket-notify-resolved del tenant
-- p_key = anon key del tenant (serve solo a passare il gateway verify_jwt;
--         l'autorizzazione vera è il segreto x-ticket-notify nell'header).
CREATE OR REPLACE FUNCTION public.ticket_notifications_send_pending(
  p_url text,
  p_key text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, vault, pg_temp
AS $$
DECLARE
  v_secret text;
  v_notif  record;
  v_count  integer := 0;
BEGIN
  SELECT decrypted_secret::text INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'autofix_cron_secret' LIMIT 1;
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'autofix_cron_secret assente nel vault (migrazione 156): la edge function rifiuterebbe la chiamata';
  END IF;

  FOR v_notif IN
    SELECT id
      FROM public.notifications
     WHERE category   = 'ticket'
       AND emailed_at IS NULL
       -- niente recuperi archeologici: se il cron è stato fermo giorni,
       -- non si spedisce una raffica di mail vecchie.
       AND created_at > now() - interval '2 days'
     ORDER BY created_at
     LIMIT 50
  LOOP
    PERFORM net.http_post(
      url     := p_url,
      body    := jsonb_build_object('notification_id', v_notif.id),
      params  := '{}'::jsonb,
      headers := jsonb_build_object(
                   'Content-Type',    'application/json',
                   'Authorization',   'Bearer ' || p_key,
                   'apikey',          p_key,
                   'x-ticket-notify', v_secret
                 ),
      timeout_milliseconds := 30000
    );

    -- emailed_at si scrive ORA, non dopo la conferma di Resend: pg_net è
    -- asincrono e una mail persa è meglio di un ciclo di rispedizioni.
    UPDATE public.notifications SET emailed_at = now() WHERE id = v_notif.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.ticket_notifications_send_pending(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ticket_notifications_send_pending(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.ticket_notifications_send_pending(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_notifications_send_pending(text, text) TO service_role;

COMMIT;

-- =====================================================================
-- SCHEDULAZIONE (fuori transazione, UNA riga per tenant — ogni 10 minuti).
-- La anon key è pubblica (sta già nel bundle JS): passa solo il gateway.
-- =====================================================================
-- NZ   — xfvfxsvqpnpvibgeqpqp
-- SELECT cron.schedule('ticket-notify-resolved-10min', '*/10 * * * *', $cron$
--   SELECT public.ticket_notifications_send_pending(
--     'https://xfvfxsvqpnpvibgeqpqp.supabase.co/functions/v1/ticket-notify-resolved',
--     '<ANON_KEY_NZ>');
-- $cron$);
--
-- Made — wdgoebzvosspjqttitra
-- SELECT cron.schedule('ticket-notify-resolved-10min', '*/10 * * * *', $cron$
--   SELECT public.ticket_notifications_send_pending(
--     'https://wdgoebzvosspjqttitra.supabase.co/functions/v1/ticket-notify-resolved',
--     '<ANON_KEY_MADE>');
-- $cron$);
--
-- Zago — jxlwvzjreukscnswkbjx
-- SELECT cron.schedule('ticket-notify-resolved-10min', '*/10 * * * *', $cron$
--   SELECT public.ticket_notifications_send_pending(
--     'https://jxlwvzjreukscnswkbjx.supabase.co/functions/v1/ticket-notify-resolved',
--     '<ANON_KEY_ZAGO>');
-- $cron$);
--
-- Verifica:  SELECT jobname, schedule, active FROM cron.job WHERE jobname='ticket-notify-resolved-10min';
-- Storico :  SELECT status, return_message, start_time FROM cron.job_run_details
--              WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='ticket-notify-resolved-10min')
--              ORDER BY start_time DESC LIMIT 5;
-- Da spedire: SELECT id, title, created_at FROM public.notifications
--              WHERE category='ticket' AND emailed_at IS NULL ORDER BY created_at DESC;
-- =====================================================================
