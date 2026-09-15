-- =====================================================================
-- Migrazione 156 — AutoFix ticket: rimesso l'innesco automatico orario
-- =====================================================================
-- COSA SUCCEDEVA: la pipeline "AutoFix" descritta in src/types/ticket.ts e
-- promessa all'utente dalla guida ("ogni ora un sistema automatico controlla
-- le segnalazioni aperte") e dal banner in /ticket ("Prossimo AutoFix
-- automatico alle HH:07") NON esisteva piu': nessun job in cron.job, nessuno
-- scheduled task, nessun workflow GitHub. L'unico innesco rimasto era il
-- bottone "Risolvi con AI" in /ticket/admin. Risultato: una segnalazione
-- aperta il 17/08/2026 e' rimasta ferma 16 giorni senza un solo commento.
--
-- COSA INTRODUCE:
--   * tickets.autofix_attempts / autofix_last_attempt_at / autofix_last_request_id
--     — memoria dei tentativi automatici, per non ripassare all'infinito
--     sugli stessi ticket.
--   * vault 'autofix_cron_secret' — segreto condiviso fra questo cron e la
--     edge function ticket-resolve-now. Generato QUI (mai scritto nel repo).
--     Serve perche' la function accetta solo super_advisor o service_role:
--     dal DB non abbiamo la service key, quindi il cron si autentica al
--     gateway con la anon key (pubblica) e si identifica alla function con
--     questo segreto nell'header x-autofix-cron.
--   * public.ticket_autofix_run(url, anon_key, max) — sceglie i ticket da
--     lavorare e li passa alla edge function via pg_net.
--
-- QUALI TICKET VENGONO PRESI (regola anti-spam):
--   stato='aperto' AND nessun commento AI gia' presente AND meno di 3
--   tentativi AND ultimo tentativo piu' vecchio di 50 minuti.
--   La function scrive SEMPRE un commento quando risponde (sia "fix" che
--   "cant_fix"): la presenza di un commento AI e' quindi la prova che il
--   ticket e' gia' stato lavorato e blocca ogni ripassata automatica. I
--   tentativi 2 e 3 servono solo ai fallimenti muti (GitHub/Anthropic giu'),
--   che non lasciano commenti. Per insistere oltre c'e' il bottone manuale.
--   Massimo 3 ticket per giro: niente raffiche sull'API Anthropic.
--
-- NO DATA LOSS: migrazione additiva (3 ADD COLUMN IF NOT EXISTS + 2 funzioni
-- + 1 secret). Nessun DELETE, nessun DROP, nessuna colonna esistente toccata.
--
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago (3 project_id).
--
-- ⚠️ LA SCHEDULAZIONE E' PER TENANT: url e anon key cambiano da progetto a
-- progetto, quindi cron.schedule NON sta in questa transazione. Dopo aver
-- applicato la migrazione, eseguire sul tenant corrispondente il comando in
-- fondo al file (sezione "SCHEDULAZIONE").
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Memoria dei tentativi automatici
-- ---------------------------------------------------------------------
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS autofix_attempts        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS autofix_last_attempt_at timestamptz,
  -- id della richiesta pg_net: permette di ritrovare la risposta della edge
  -- function in net._http_response quando un tentativo non lascia traccia.
  ADD COLUMN IF NOT EXISTS autofix_last_request_id bigint;

COMMENT ON COLUMN public.tickets.autofix_attempts IS
  'Quante volte il cron orario ha passato il ticket a ticket-resolve-now (max 3).';
COMMENT ON COLUMN public.tickets.autofix_last_attempt_at IS
  'Ultimo tentativo automatico. NULL = mai passato dal cron.';

-- ---------------------------------------------------------------------
-- 2. Segreto condiviso cron -> edge function
-- ---------------------------------------------------------------------
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'autofix_cron_secret') THEN
    PERFORM vault.create_secret(
      -- 64 caratteri esadecimali, generati nel DB: non transita da nessuna parte
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'autofix_cron_secret',
      'Segreto condiviso fra il cron ticket-autofix-hourly e la edge function ticket-resolve-now (header x-autofix-cron)'
    );
  END IF;
END
$mig$;

-- Letto dalla edge function via RPC (come get_github_token / get_anthropic_api_key).
CREATE OR REPLACE FUNCTION public.get_autofix_cron_secret()
RETURNS TABLE(secret text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret::text FROM vault.decrypted_secrets WHERE name = 'autofix_cron_secret' LIMIT 1;
$$;

-- Migrazione 154 docet: mai EXECUTE ad anon su una SECURITY DEFINER.
REVOKE ALL ON FUNCTION public.get_autofix_cron_secret() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_autofix_cron_secret() FROM anon;
REVOKE ALL ON FUNCTION public.get_autofix_cron_secret() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_autofix_cron_secret() TO service_role;

-- ---------------------------------------------------------------------
-- 3. Il giro orario
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ticket_autofix_run(
  p_function_url text,
  p_anon_key     text,
  p_max_tickets  integer DEFAULT 3
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, vault
AS $$
DECLARE
  v_secret  text;
  v_ticket  record;
  v_request bigint;
  v_count   integer := 0;
BEGIN
  SELECT decrypted_secret::text INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'autofix_cron_secret' LIMIT 1;
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'autofix_cron_secret assente nel vault: la edge function rifiuterebbe la chiamata';
  END IF;

  FOR v_ticket IN
    SELECT id
      FROM public.tickets
     WHERE stato = 'aperto'
       AND COALESCE(autofix_attempts, 0) < 3
       AND (autofix_last_attempt_at IS NULL OR autofix_last_attempt_at < now() - interval '50 minutes')
       -- Gia' risposto dall'AI (fix o cant_fix) => il cron non ci torna sopra.
       AND NOT EXISTS (
             SELECT 1
               FROM jsonb_array_elements(COALESCE(commenti, '[]'::jsonb)) AS c
              WHERE c->>'origine' = 'ai'
           )
     ORDER BY creato_il
     LIMIT GREATEST(p_max_tickets, 0)
  LOOP
    -- pg_net e' asincrono: la function gira 10-60s (chiamata Claude + GitHub),
    -- quindi timeout generoso, altrimenti la richiesta verrebbe troncata.
    SELECT net.http_post(
      url                 := p_function_url,
      body                := jsonb_build_object('ticketId', v_ticket.id),
      params              := '{}'::jsonb,
      headers             := jsonb_build_object(
                               'Content-Type',   'application/json',
                               -- anon key: serve solo a passare il gateway (verify_jwt)
                               'Authorization',  'Bearer ' || p_anon_key,
                               'apikey',         p_anon_key,
                               -- questo e' cio' che autorizza davvero il cron
                               'x-autofix-cron', v_secret
                             ),
      timeout_milliseconds := 120000
    ) INTO v_request;

    UPDATE public.tickets
       SET autofix_attempts        = COALESCE(autofix_attempts, 0) + 1,
           autofix_last_attempt_at = now(),
           autofix_last_request_id = v_request
     WHERE id = v_ticket.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.ticket_autofix_run(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ticket_autofix_run(text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.ticket_autofix_run(text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_autofix_run(text, text, integer) TO service_role;

COMMIT;

-- =====================================================================
-- SCHEDULAZIONE (fuori transazione, UNA riga per tenant — :07 di ogni ora,
-- lo stesso minuto mostrato dal banner AutoFixCountdown in /ticket).
-- La anon key e' pubblica (sta gia' nel bundle JS): serve solo a passare il
-- gateway verify_jwt, l'autorizzazione vera e' il segreto x-autofix-cron.
-- Applicate tutte e tre il 2026-09-02.
-- =====================================================================
-- NZ   — xfvfxsvqpnpvibgeqpqp
-- SELECT cron.schedule('ticket-autofix-hourly', '7 * * * *', $cron$
--   SELECT public.ticket_autofix_run(
--     'https://xfvfxsvqpnpvibgeqpqp.supabase.co/functions/v1/ticket-resolve-now',
--     'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmdmZ4c3ZxcG5wdmliZ2VxcHFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNDkwNDcsImV4cCI6MjA5MDcyNTA0N30.ohYziAXiOWS0TKU9HHuhUAbf5Geh10xbLGEoftOMJZA');
-- $cron$);
--
-- Made — wdgoebzvosspjqttitra
-- SELECT cron.schedule('ticket-autofix-hourly', '7 * * * *', $cron$
--   SELECT public.ticket_autofix_run(
--     'https://wdgoebzvosspjqttitra.supabase.co/functions/v1/ticket-resolve-now',
--     'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndkZ29lYnp2b3NzcGpxdHRpdHJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzMxMDUsImV4cCI6MjA5MzY0OTEwNX0.gU6D41nojoX6tSAPrJIWLWrBhxKI9ua1EhQ8f9W4zLs');
-- $cron$);
--
-- Zago — jxlwvzjreukscnswkbjx
-- SELECT cron.schedule('ticket-autofix-hourly', '7 * * * *', $cron$
--   SELECT public.ticket_autofix_run(
--     'https://jxlwvzjreukscnswkbjx.supabase.co/functions/v1/ticket-resolve-now',
--     'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4bHd2empyZXVrc2Nuc3drYmp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzQxNzQsImV4cCI6MjA5MzY1MDE3NH0.leQ6ggCx7M81BnOH9JEpn6MWQfHMdDnUmmUfwIgKzV4');
-- $cron$);
--
-- Verifica:  SELECT jobname, schedule, active FROM cron.job WHERE jobname='ticket-autofix-hourly';
-- Storico :  SELECT status, return_message, start_time FROM cron.job_run_details
--              WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='ticket-autofix-hourly')
--              ORDER BY start_time DESC LIMIT 5;
-- Risposte:  SELECT t.titolo, r.status_code, left(r.content,200)
--              FROM public.tickets t JOIN net._http_response r ON r.id = t.autofix_last_request_id
--             ORDER BY t.autofix_last_attempt_at DESC LIMIT 5;
-- =====================================================================
