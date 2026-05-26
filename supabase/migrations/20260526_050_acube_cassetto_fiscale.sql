-- Migration 050: Cassetto Fiscale A-Cube — config per tenant
--
-- Vedi memorie: project_eppi_sdi_intermediario, project_acube_provider
-- Modello operativo: EPPI = Appointee per i clienti (decisione 2026-05-26).
--   - Patrizio Donnini è la persona fisica Appointee A-Cube
--   - I clienti nominano Patrizio su AdE (azione una tantum per tenant)
--   - A-Cube usa le credenziali Fisconline di Patrizio per accedere ai cassetti
--
-- Workflow status:
-- 1. not_configured: BRC creato ma niente Cassetto
-- 2. awaiting_client_appointment: cliente deve loggare su AdE e nominare Patrizio
-- 3. active: nomina + assign API OK + test download massivo OK
-- 4. credentials_expired: password Fisconline EPPI scaduta (90gg)
-- 5. error: indagare manualmente

CREATE TABLE IF NOT EXISTS public.acube_cassetto_fiscale_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  business_registry_uuid TEXT NOT NULL,
  fiscal_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('sandbox', 'production')),
  status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN (
    'not_configured', 'awaiting_client_appointment', 'active',
    'credentials_expired', 'error'
  )),
  appointee_fiscal_id TEXT,
  appointee_assigned_at TIMESTAMPTZ,
  appointee_assigned_by_user_id UUID,
  last_status_check_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  last_sync_invoices_count INTEGER DEFAULT 0,
  error_message TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, business_registry_uuid, stage)
);

COMMENT ON TABLE public.acube_cassetto_fiscale_config IS
  'Stato integrazione Cassetto Fiscale A-Cube per tenant. Una riga per (company, BRC, stage). Setup tramite EPPI Appointee modello (vedi memoria project_eppi_sdi_intermediario).';
COMMENT ON COLUMN public.acube_cassetto_fiscale_config.appointee_fiscal_id IS
  'CF della persona fisica Appointee. Per EPPI è il CF personale di Patrizio Donnini.';

CREATE INDEX IF NOT EXISTS idx_acf_company_stage ON public.acube_cassetto_fiscale_config(company_id, stage);
CREATE INDEX IF NOT EXISTS idx_acf_status ON public.acube_cassetto_fiscale_config(status) WHERE status != 'active';

CREATE OR REPLACE FUNCTION public.trg_acube_cf_config_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_acube_cf_config_updated_at ON public.acube_cassetto_fiscale_config;
CREATE TRIGGER set_acube_cf_config_updated_at
  BEFORE UPDATE ON public.acube_cassetto_fiscale_config
  FOR EACH ROW EXECUTE FUNCTION public.trg_acube_cf_config_updated_at();

ALTER TABLE public.acube_cassetto_fiscale_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acube_cf_read_by_company" ON public.acube_cassetto_fiscale_config
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

CREATE POLICY "acube_cf_write_super_advisor" ON public.acube_cassetto_fiscale_config
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND public.get_my_role() = 'super_advisor')
  WITH CHECK (company_id = public.get_my_company_id() AND public.get_my_role() = 'super_advisor');

-- ─────────────────────────────────────────────────────────────────────
-- Storico download massivi (audit + metriche)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.acube_cassetto_fiscale_pulls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.acube_cassetto_fiscale_config(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  date_from DATE,
  date_to DATE,
  invoice_type TEXT CHECK (invoice_type IN ('passive', 'active', 'both')),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  invoices_fetched INTEGER DEFAULT 0,
  invoices_inserted INTEGER DEFAULT 0,
  invoices_duplicates INTEGER DEFAULT 0,
  invoices_failed INTEGER DEFAULT 0,
  triggered_by_user_id UUID,
  triggered_by_cron BOOLEAN DEFAULT false,
  error_message TEXT,
  raw_response JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER GENERATED ALWAYS AS (
    CASE WHEN completed_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (completed_at - started_at))::int * 1000
      ELSE NULL
    END
  ) STORED
);

COMMENT ON TABLE public.acube_cassetto_fiscale_pulls IS
  'Storico delle chiamate di download massivo dal Cassetto Fiscale via A-Cube. Audit + metriche per debug.';

CREATE INDEX IF NOT EXISTS idx_acf_pulls_company ON public.acube_cassetto_fiscale_pulls(company_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_acf_pulls_config ON public.acube_cassetto_fiscale_pulls(config_id, started_at DESC);

ALTER TABLE public.acube_cassetto_fiscale_pulls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acube_cf_pulls_read_by_company" ON public.acube_cassetto_fiscale_pulls
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

CREATE POLICY "acube_cf_pulls_write_service" ON public.acube_cassetto_fiscale_pulls
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
