-- =====================================================================
-- 333 — Stessa password su New Zago, Made e Zago (tutti e 3 i tenant)
-- =====================================================================
-- Ogni tenant ha il suo archivio di accessi (ADR-001, multi-tenant fisico).
-- Patrizio (30/10/2026): «con un unico nome utente e password si accede
-- ovunque». Il 30/10 le password dell'ufficio sono state copiate da NZ a
-- Made e Zago; questa migration le tiene allineate da qui in avanti.
--
-- COME FUNZIONA
--   * Trigger su auth.users: quando cambia la password cifrata di una
--     persona (Profilo, «password dimenticata», Impostazioni → Utenti,
--     pannello Supabase) il tenant la manda agli altri due con pg_net,
--     chiamando la RPC password_sync_receive di ciascuno.
--   * Viaggia SOLO la password cifrata (bcrypt), mai quella in chiaro.
--   * Il ricevente la applica solo se:
--       - la chiamata porta il segreto condiviso (header x-password-sync,
--         uguale al segreto `password_sync_secret` del suo Vault);
--       - l'email esiste già da lui (gli account cassa di un negozio NZ
--         non esistono su Zago: non vengono creati);
--       - il cambio è più recente dell'ultimo che conosce.
--   * Niente rimbalzi: l'aggiornamento ricevuto non riparte verso gli altri.
--   * Un errore qui non blocca mai il cambio password né l'accesso.
--
-- CONFIGURAZIONE (dati, non codice: nessun valore di un tenant qui)
--   * public.password_sync_peers: gli altri due tenant (URL + chiave
--     pubblica), scritti con execute_sql su ogni tenant.
--   * Vault `password_sync_secret`: stesso valore sui 3 tenant, lo inserisce
--     Patrizio. Finché manca, il trigger non manda niente (lo scrive nel log).
--
-- Note complete: PASSWORD_SYNC_NOTES.md
-- Rollback: 20261030_333_sincronizzazione_password_ROLLBACK.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabelle di servizio: RLS senza policy e nessun GRANT, invisibili all'API
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.password_sync_peers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  rest_url    text        NOT NULL,
  anon_key    text        NOT NULL,
  enabled     boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.password_sync_peers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_sync_peers FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.password_sync_state (
  email            text        PRIMARY KEY,
  last_changed_at  timestamptz NOT NULL
);
ALTER TABLE public.password_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_sync_state FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.password_sync_log (
  id          bigserial   PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  direction   text        NOT NULL CHECK (direction IN ('out', 'in')),
  email       text,
  peer        text,
  status      text        NOT NULL,
  detail      text,
  request_id  bigint
);
ALTER TABLE public.password_sync_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_sync_log FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- Invio: trigger su auth.users
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.password_sync_on_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, vault, pg_temp
AS $$
DECLARE
  v_secret text;
  v_email  text;
  v_at     timestamptz := clock_timestamp();
  p        record;
  v_req    bigint;
BEGIN
  -- aggiornamento arrivato da un altro tenant: non si rimanda indietro
  IF coalesce(current_setting('app.password_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.email IS NULL
     OR coalesce(NEW.encrypted_password, '') = ''
     OR NEW.encrypted_password IS NOT DISTINCT FROM OLD.encrypted_password THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_email := lower(NEW.email);

    INSERT INTO public.password_sync_state (email, last_changed_at)
    VALUES (v_email, v_at)
    ON CONFLICT (email) DO UPDATE SET last_changed_at = excluded.last_changed_at;

    SELECT decrypted_secret::text INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'password_sync_secret' LIMIT 1;
    IF v_secret IS NULL THEN
      INSERT INTO public.password_sync_log (direction, email, status, detail)
      VALUES ('out', v_email, 'skipped', 'password_sync_secret assente nel Vault');
      RETURN NEW;
    END IF;

    FOR p IN SELECT * FROM public.password_sync_peers WHERE enabled ORDER BY name LOOP
      SELECT net.http_post(
        url     := rtrim(p.rest_url, '/') || '/rest/v1/rpc/password_sync_receive',
        body    := jsonb_build_object('p_email', v_email,
                                      'p_hash', NEW.encrypted_password,
                                      'p_changed_at', v_at),
        params  := '{}'::jsonb,
        headers := jsonb_build_object(
                     'Content-Type',    'application/json',
                     'apikey',          p.anon_key,
                     'Authorization',   'Bearer ' || p.anon_key,
                     'x-password-sync', v_secret),
        timeout_milliseconds := 10000
      ) INTO v_req;
      INSERT INTO public.password_sync_log (direction, email, peer, status, request_id)
      VALUES ('out', v_email, p.name, 'sent', v_req);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- mai bloccare il cambio password
    BEGIN
      INSERT INTO public.password_sync_log (direction, email, status, detail)
      VALUES ('out', lower(NEW.email), 'error', left(SQLERRM, 300));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.password_sync_on_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_password_sync ON auth.users;
CREATE TRIGGER trg_password_sync
  AFTER UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.password_sync_on_change();

-- ---------------------------------------------------------------------
-- Ricezione: RPC chiamata dagli altri due tenant
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.password_sync_receive(p_email text, p_hash text, p_changed_at timestamptz)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_secret text;
  v_given  text;
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_uid    uuid;
  v_last   timestamptz;
BEGIN
  BEGIN
    v_given := current_setting('request.headers', true)::json ->> 'x-password-sync';
  EXCEPTION WHEN OTHERS THEN v_given := NULL;
  END;
  SELECT decrypted_secret::text INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'password_sync_secret' LIMIT 1;
  -- senza segreto valido non si scrive niente, nemmeno nel log
  IF v_secret IS NULL OR length(v_secret) < 32 OR v_given IS NULL OR v_given <> v_secret THEN
    RETURN 'refused';
  END IF;

  IF p_hash IS NULL OR p_hash !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' OR p_changed_at IS NULL THEN
    INSERT INTO public.password_sync_log (direction, email, status) VALUES ('in', v_email, 'invalid');
    RETURN 'invalid';
  END IF;

  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = v_email LIMIT 1;
  IF v_uid IS NULL THEN
    INSERT INTO public.password_sync_log (direction, email, status) VALUES ('in', v_email, 'no_user');
    RETURN 'no_user';
  END IF;

  SELECT last_changed_at INTO v_last FROM public.password_sync_state WHERE email = v_email;
  IF v_last IS NOT NULL AND v_last >= p_changed_at THEN
    INSERT INTO public.password_sync_log (direction, email, status) VALUES ('in', v_email, 'stale');
    RETURN 'stale';
  END IF;

  PERFORM set_config('app.password_sync', 'on', true);
  UPDATE auth.users SET encrypted_password = p_hash, updated_at = now() WHERE id = v_uid;
  INSERT INTO public.password_sync_state (email, last_changed_at)
  VALUES (v_email, p_changed_at)
  ON CONFLICT (email) DO UPDATE SET last_changed_at = excluded.last_changed_at;
  INSERT INTO public.password_sync_log (direction, email, status) VALUES ('in', v_email, 'applied');
  RETURN 'applied';
END
$$;
REVOKE ALL ON FUNCTION public.password_sync_receive(text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.password_sync_receive(text, text, timestamptz) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- VERIFICA (su ogni tenant)
-- ---------------------------------------------------------------------
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = 'trg_password_sync';
-- SELECT name, enabled FROM public.password_sync_peers ORDER BY name;      -- gli altri due tenant
-- SELECT count(*) FROM vault.secrets WHERE name = 'password_sync_secret';  -- 1
-- SELECT * FROM public.password_sync_log ORDER BY at DESC LIMIT 20;
