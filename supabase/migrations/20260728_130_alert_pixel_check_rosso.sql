-- =====================================================================
-- Migrazione 130 — ALERT IN-APP se il Pixel check (CI) diventa ROSSO
-- =====================================================================
--
-- OBIETTIVO
-- Avvisare in campanella 🔔 quando la verifica pixel (workflow GitHub
-- .github/workflows/pixel-check.yml) fallisce sui site deployati, senza
-- dipendere da notifiche GitHub né da secret.
--
-- COME
-- Il repo è PUBBLICO, quindi l'API GitHub che riporta l'esito dell'ultimo run
-- si legge SENZA token. La funzione public.check_pixel_and_alert():
--   - fa una GET sincrona (estensione `http`) all'endpoint runs del workflow;
--   - prende l'ultimo run COMPLETATO su main;
--   - se 'success' → chiude (dismissed) eventuali alert rossi precedenti;
--   - se rosso (failure/timed_out/cancelled) → inserisce UNA notifica critica
--     in `notifications` (dedup per run id), che compare nella campanella.
-- Schedulata con pg_cron ogni 30 minuti.
--
-- CARATTERE: additiva/non distruttiva (nuova funzione + job cron). Nessun
--   secret, nessuna azione manuale: il monitor "tira" da GitHub, non il
--   contrario.
--
-- ⚠️ REGOLA #0 — PARITÀ TENANT: applicata via MCP su NZ + Made + Zago.
--   NZ = xfvfxsvqpnpvibgeqpqp | Made = wdgoebzvosspjqttitra | Zago = jxlwvzjreukscnswkbjx
--   (pg_cron è per-database: il job va creato su ciascun tenant.)
-- Rollback + verifiche in coda.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.check_pixel_and_alert()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_body text; v_run jsonb; v_concl text; v_id text; v_url text;
  v_company uuid := (SELECT id FROM public.companies LIMIT 1);
BEGIN
  -- GET sincrona all'API pubblica GitHub (repo pubblico → nessun token)
  SELECT (r).content INTO v_body
  FROM public.http((
    'GET',
    'https://api.github.com/repos/pdonnini-pixel/gestionale-nz/actions/workflows/pixel-check.yml/runs?branch=main&per_page=10',
    ARRAY[public.http_header('User-Agent','supabase-pixel-check'),
          public.http_header('Accept','application/vnd.github+json')],
    NULL, NULL)::public.http_request) r;

  -- ultimo run COMPLETATO su main
  SELECT x INTO v_run
  FROM jsonb_array_elements(coalesce(v_body::jsonb->'workflow_runs','[]'::jsonb)) x
  WHERE x->>'status' = 'completed'
  ORDER BY (x->>'created_at') DESC
  LIMIT 1;

  IF v_run IS NULL THEN RETURN 'nessun run completato'; END IF;
  v_concl := v_run->>'conclusion';
  v_id    := v_run->>'id';
  v_url   := v_run->>'html_url';

  -- verde → pulizia degli alert rossi precedenti
  IF v_concl = 'success' THEN
    UPDATE public.notifications SET dismissed = true
    WHERE reference_type = 'pixel_check' AND dismissed = false;
    RETURN 'verde';
  END IF;

  -- rosso → alert critico in campanella (una sola volta per run)
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE company_id = v_company AND reference_type = 'pixel_check'
      AND message LIKE '%run ' || v_id || '%'
  ) THEN
    INSERT INTO public.notifications (company_id, title, message, category, severity, reference_type)
    VALUES (
      v_company,
      'Pixel check FALLITO (' || coalesce(v_concl,'?') || ')',
      'La verifica pixel automatica del sito è rossa. Apri il report su GitHub Actions (run '
        || v_id || '): ' || coalesce(v_url,''),
      'sistema', 'critical', 'pixel_check'
    );
  END IF;
  RETURN 'rosso: ' || coalesce(v_concl,'?');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_pixel_and_alert() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_pixel_and_alert() TO authenticated, service_role;

-- Schedulazione pg_cron — ogni 30 minuti (ri-eseguibile).
SELECT cron.unschedule('alert-pixel-check-rosso')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'alert-pixel-check-rosso');
SELECT cron.schedule('alert-pixel-check-rosso', '*/30 * * * *', $$SELECT public.check_pixel_and_alert();$$);

-- Primo giro subito
SELECT public.check_pixel_and_alert();

-- =====================================================================
-- ROLLBACK (a mano)
--   SELECT cron.unschedule('alert-pixel-check-rosso');
--   DROP FUNCTION IF EXISTS public.check_pixel_and_alert();
--   UPDATE public.notifications SET dismissed=true WHERE reference_type='pixel_check';
-- VERIFICHE
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname='alert-pixel-check-rosso';
--   SELECT public.check_pixel_and_alert();  -- 'verde' se l'ultimo run è ok
-- =====================================================================
