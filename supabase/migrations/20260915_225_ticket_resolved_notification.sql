-- =====================================================================
-- 225 — Segnalazione risolta: avviso in app e mail a chi l'ha aperta
-- =====================================================================
-- Richiesta di Patrizio (rifatta da zero il 15/09/2026, al posto della PR
-- #446 mai applicata): quando una segnalazione passa a «risolto», chi l'ha
-- aperta deve saperlo senza andare a controllare. Un ticket puo' essere
-- risolto da quattro strade (Ticket.tsx, TicketAdmin.tsx, edge function
-- ticket-resolve-now dal cron orario, task AutoFix via SQL): un trigger sulla
-- tabella le copre tutte.
--
-- COSA INTRODUCE:
--   * notifications.emailed_at: quando la mail e' stata spedita davvero
--     (lo scrive la edge function dopo la conferma di Resend).
--   * ticket_notify_endpoint(): URL della edge function ticket-notify-resolved
--     e anon key del tenant, ricavati dallo stesso posto del report serale
--     (daily_report_endpoint(), migration 204): niente valori di tenant nel
--     codice, niente cron in piu', niente segreto nuovo.
--   * notify_ticket_resolved() + trigger trg_notify_ticket_resolved:
--     alla risoluzione crea la notifica in app per l'autore (la vede solo
--     lui: policy notifications_select su user_id) e chiama subito la edge
--     function con net.http_post, autorizzata dal segreto condiviso
--     x-autofix-cron (vault autofix_cron_secret, migration 156), come il
--     report serale. Tutto dentro un blocco EXCEPTION: un errore qui non
--     puo' impedire la risoluzione del ticket.
--   * Dedup: se per lo stesso ticket c'e' gia' una notifica negli ultimi
--     10 minuti non se ne crea un'altra. Una segnalazione riaperta e
--     risolta di nuovo, invece, avvisa di nuovo: e' giusto cosi'.
-- Additiva (ADD COLUMN IF NOT EXISTS, funzioni, trigger). REGOLA #0: NZ ->
-- Made -> Zago. La mail parte solo dove la edge function e' deployata e i
-- secret RESEND_API_KEY / DISTINTA_EMAIL_FROM esistono (gia' in uso).
-- =====================================================================
BEGIN;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
-- La categoria «ticket» non era fra quelle ammesse dal vincolo (scoperto alla
-- prima prova: il trigger ingoiava l'errore e la notifica non nasceva).
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check
  CHECK (category = ANY (ARRAY['scadenza_fiscale','scadenza_fornitore','anomalia','riconciliazione','fattura_sdi','sistema','info','ticket']));
COMMENT ON COLUMN public.notifications.emailed_at IS 'Quando la mail della notifica e'' stata spedita (scritto dalla edge function dopo la conferma del provider). NULL = nessuna mail.';

-- Endpoint della edge function ticket-notify-resolved: stesso progetto e
-- stessa anon key del report serale, letti dal job pg_cron esistente.
CREATE OR REPLACE FUNCTION public.ticket_notify_endpoint(OUT function_url text, OUT anon_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT e.function_url, e.anon_key INTO v_url, v_key FROM public.daily_report_endpoint() e;
  IF v_url IS NULL THEN RETURN; END IF;
  function_url := regexp_replace(v_url, '/functions/v1/[^/]+$', '/functions/v1/ticket-notify-resolved');
  anon_key     := v_key;
END;
$$;
REVOKE ALL ON FUNCTION public.ticket_notify_endpoint() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ticket_notify_endpoint() TO service_role;

CREATE OR REPLACE FUNCTION public.notify_ticket_resolved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, vault, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_last_ai    text;
  v_message    text;
  v_notif_id   uuid;
  v_url        text;
  v_key        text;
  v_secret     text;
BEGIN
  -- Autore senza profilo o senza azienda: niente da fare, e nessun errore.
  IF NEW.autore_id IS NULL THEN RETURN NEW; END IF;
  SELECT up.company_id INTO v_company_id FROM public.user_profiles up WHERE up.id = NEW.autore_id LIMIT 1;
  IF v_company_id IS NULL THEN RETURN NEW; END IF;

  -- Dedup a breve: due UPDATE ravvicinati (es. stato + risolto_il in due
  -- passaggi) non devono produrre due avvisi.
  IF EXISTS (
    SELECT 1 FROM public.notifications n
     WHERE n.reference_type = 'ticket' AND n.reference_id = NEW.id
       AND n.created_at > now() - interval '10 minutes'
  ) THEN RETURN NEW; END IF;

  -- Cosa e' stato fatto: ultimo commento AutoFix (origine 'ai'), se c'e',
  -- altrimenti le note di risoluzione scritte a mano.
  SELECT left(c.value->>'testo', 300) INTO v_last_ai
    FROM jsonb_array_elements(COALESCE(NEW.commenti, '[]'::jsonb)) AS c(value)
   WHERE c.value->>'origine' = 'ai' AND COALESCE(c.value->>'testo', '') <> ''
   ORDER BY c.value->>'creato_il' DESC NULLS LAST
   LIMIT 1;
  v_message := COALESCE(NULLIF(trim(NEW.titolo), ''), 'La tua segnalazione');
  IF v_last_ai IS NOT NULL THEN
    v_message := v_message || ' · ' || v_last_ai;
  ELSIF COALESCE(NEW.note_fix, '') <> '' THEN
    v_message := v_message || ' · ' || left(NEW.note_fix, 300);
  END IF;

  INSERT INTO public.notifications
    (company_id, user_id, title, message, category, severity, action_url, action_label, reference_type, reference_id)
  VALUES
    (v_company_id, NEW.autore_id, 'Segnalazione risolta', v_message, 'ticket', 'info',
     '/ticket/' || NEW.id::text, 'Apri la segnalazione', 'ticket', NEW.id)
  RETURNING id INTO v_notif_id;

  -- Mail: chiamata asincrona alla edge function (pg_net), stesso segreto
  -- condiviso del report serale. Se manca qualcosa la notifica in app resta.
  SELECT e.function_url, e.anon_key INTO v_url, v_key FROM public.ticket_notify_endpoint() e;
  SELECT decrypted_secret::text INTO v_secret FROM vault.decrypted_secrets WHERE name = 'autofix_cron_secret' LIMIT 1;
  IF v_url IS NOT NULL AND v_key IS NOT NULL AND v_secret IS NOT NULL THEN
    PERFORM net.http_post(
      url     := v_url,
      body    := jsonb_build_object('notification_id', v_notif_id),
      params  := '{}'::jsonb,
      headers := jsonb_build_object(
                   'Content-Type',   'application/json',
                   'Authorization',  'Bearer ' || v_key,
                   'apikey',         v_key,
                   'x-autofix-cron', v_secret),
      timeout_milliseconds := 30000
    );
  ELSE
    RAISE WARNING 'notify_ticket_resolved(%): endpoint o segreto assenti, mail non inviata', NEW.id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
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

COMMIT;

-- Verifica:
--   SELECT * FROM public.ticket_notify_endpoint();
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.tickets'::regclass AND tgname = 'trg_notify_ticket_resolved';
--   SELECT id, title, emailed_at, created_at FROM public.notifications WHERE category = 'ticket' ORDER BY created_at DESC LIMIT 5;
