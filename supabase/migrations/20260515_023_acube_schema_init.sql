-- Migrazione 023 — Setup schema A-Cube (Open Banking + SDI)
-- Tabelle vuote, pronte per ricevere dati appena le Edge Functions sono deployate.
-- Niente Vault credentials qui: vanno aggiunte da UI Supabase con prefisso acube_*.
-- Convenzione: acube_sandbox_email/password (test), acube_main_email/password (prod).

-- ============================================================
-- Tabella: acube_tokens — cache JWT 24h
-- ============================================================
CREATE TABLE IF NOT EXISTS public.acube_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage TEXT NOT NULL CHECK (stage IN ('sandbox', 'production')),
  jwt TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stage)
);

ALTER TABLE public.acube_tokens ENABLE ROW LEVEL SECURITY;

-- Solo service_role (Edge Functions)
CREATE POLICY acube_tokens_service_only ON public.acube_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.acube_tokens IS 'Cache JWT A-Cube (24h). Una riga per stage. Gestita da Edge Function acube-login.';

-- ============================================================
-- Tabella: acube_business_registries — entità fiscali su A-Cube
-- ============================================================
CREATE TABLE IF NOT EXISTS public.acube_business_registries (
  uuid UUID PRIMARY KEY,
  fiscal_id TEXT NOT NULL UNIQUE,
  business_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'company' CHECK (type IN ('company', 'individual')),
  locale TEXT DEFAULT 'it',
  country TEXT DEFAULT 'IT',
  enabled BOOLEAN DEFAULT true,
  email_alerts BOOLEAN DEFAULT true,
  sub_account_id INTEGER,
  stage TEXT NOT NULL CHECK (stage IN ('sandbox', 'production')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.acube_business_registries ENABLE ROW LEVEL SECURITY;

CREATE POLICY acube_br_read_authenticated ON public.acube_business_registries
  FOR SELECT TO authenticated USING (true);

CREATE POLICY acube_br_service_write ON public.acube_business_registries
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.acube_business_registries IS 'Business Registry su A-Cube. 1 riga per ogni P.IVA tenant. uuid = identificatore A-Cube.';

-- ============================================================
-- Tabella: acube_accounts — conti bancari connessi via PSD2
-- ============================================================
CREATE TABLE IF NOT EXISTS public.acube_accounts (
  uuid UUID PRIMARY KEY,
  business_registry_uuid UUID NOT NULL REFERENCES public.acube_business_registries(uuid) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  connection_id TEXT,
  provider_name TEXT NOT NULL,
  provider_country TEXT,
  name TEXT NOT NULL,
  nature TEXT NOT NULL,
  balance NUMERIC(15, 2),
  currency_code TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  consent_expires_at TIMESTAMPTZ,
  iban TEXT,
  bban TEXT,
  swift TEXT,
  account_number TEXT,
  extra JSONB,
  systems TEXT[],
  bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_acube_accounts_br ON public.acube_accounts(business_registry_uuid);
CREATE INDEX idx_acube_accounts_bank ON public.acube_accounts(bank_account_id);

ALTER TABLE public.acube_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY acube_accounts_read_authenticated ON public.acube_accounts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY acube_accounts_service_write ON public.acube_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.acube_accounts IS 'Conti bancari A-Cube. Mappati a bank_accounts via bank_account_id. Aggiornati da Edge Function acube-transactions-sync.';

-- ============================================================
-- Tabella: acube_consents — log consensi PSD2 (granted, expired, reconnect)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.acube_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_registry_uuid UUID NOT NULL REFERENCES public.acube_business_registries(uuid) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'expired', 'reconnect_required', 'revoked')),
  connect_url TEXT,
  granted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  days INTEGER CHECK (days BETWEEN 1 AND 180),
  notice_level TEXT,
  raw_webhook JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_acube_consents_br ON public.acube_consents(business_registry_uuid);
CREATE INDEX idx_acube_consents_status ON public.acube_consents(status);
CREATE INDEX idx_acube_consents_expires ON public.acube_consents(expires_at) WHERE status = 'active';

ALTER TABLE public.acube_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY acube_consents_read_authenticated ON public.acube_consents
  FOR SELECT TO authenticated USING (true);

CREATE POLICY acube_consents_service_write ON public.acube_consents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.acube_consents IS 'Audit consensi PSD2 A-Cube. Notice/reconnect arrivano qui da webhook. Una riga per ogni connect_request + ogni reconnect.';

-- ============================================================
-- Tabella: acube_webhook_log — audit di tutti i webhook ricevuti
-- ============================================================
CREATE TABLE IF NOT EXISTS public.acube_webhook_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event TEXT NOT NULL CHECK (event IN ('connect', 'reconnect', 'payment')),
  payload JSONB NOT NULL,
  signature_valid BOOLEAN NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  processing_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_acube_webhook_log_event ON public.acube_webhook_log(event, received_at DESC);
CREATE INDEX idx_acube_webhook_log_unprocessed ON public.acube_webhook_log(processed, received_at) WHERE NOT processed;

ALTER TABLE public.acube_webhook_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY acube_webhook_log_read_authenticated ON public.acube_webhook_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY acube_webhook_log_service_write ON public.acube_webhook_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.acube_webhook_log IS 'Audit webhook A-Cube ricevuti. signature_valid traccia esito verifica Ed25519. processed=false per retry.';

-- ============================================================
-- RPC: get_acube_credentials — solo service_role (Edge Functions)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_acube_credentials(p_stage TEXT)
RETURNS TABLE(email TEXT, password TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, vault
AS $$
DECLARE
  v_email TEXT;
  v_password TEXT;
  v_email_secret TEXT;
  v_password_secret TEXT;
BEGIN
  IF p_stage NOT IN ('sandbox', 'production') THEN
    RAISE EXCEPTION 'Invalid stage: %. Use sandbox or production.', p_stage;
  END IF;

  -- Convenzione naming: acube_sandbox_email/password, acube_main_email/password
  IF p_stage = 'sandbox' THEN
    v_email_secret := 'acube_sandbox_email';
    v_password_secret := 'acube_sandbox_password';
  ELSE
    v_email_secret := 'acube_main_email';
    v_password_secret := 'acube_main_password';
  END IF;

  SELECT decrypted_secret INTO v_email FROM vault.decrypted_secrets WHERE name = v_email_secret LIMIT 1;
  SELECT decrypted_secret INTO v_password FROM vault.decrypted_secrets WHERE name = v_password_secret LIMIT 1;

  IF v_email IS NULL OR v_password IS NULL THEN
    RAISE EXCEPTION 'A-Cube credentials missing in Vault for stage: % (expected secrets: %, %)',
      p_stage, v_email_secret, v_password_secret;
  END IF;

  RETURN QUERY SELECT v_email, v_password;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_acube_credentials(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_acube_credentials(TEXT) TO service_role;

COMMENT ON FUNCTION public.get_acube_credentials(TEXT) IS 'Ritorna email/password A-Cube dal Vault. Solo Edge Functions (service_role).';

-- ============================================================
-- Trigger updated_at
-- ============================================================
CREATE TRIGGER trg_acube_tokens_updated BEFORE UPDATE ON public.acube_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_acube_business_registries_updated BEFORE UPDATE ON public.acube_business_registries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_acube_accounts_updated BEFORE UPDATE ON public.acube_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_acube_consents_updated BEFORE UPDATE ON public.acube_consents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
