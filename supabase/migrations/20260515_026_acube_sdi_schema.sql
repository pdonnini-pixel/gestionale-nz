-- Migrazione 026 — Schema A-Cube SDI (fatture attive + passive + BRC)
-- direction='passive' = fattura ricevuta da fornitore via SDI
-- direction='active' = fattura emessa da noi inviata a SDI

CREATE TABLE IF NOT EXISTS public.acube_sdi_business_registry_configs (
  fiscal_id TEXT PRIMARY KEY,
  vat_number TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  customer_invoice_enabled BOOLEAN DEFAULT true,
  supplier_invoice_enabled BOOLEAN DEFAULT true,
  receipts_enabled BOOLEAN DEFAULT false,
  legal_storage_active BOOLEAN DEFAULT false,
  apply_signature BOOLEAN,
  stage TEXT NOT NULL CHECK (stage IN ('sandbox', 'production')),
  raw_config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.acube_sdi_business_registry_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY acube_sdi_brc_read_authenticated ON public.acube_sdi_business_registry_configs FOR SELECT TO authenticated USING (true);
CREATE POLICY acube_sdi_brc_service_write ON public.acube_sdi_business_registry_configs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.acube_sdi_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acube_uuid UUID NOT NULL UNIQUE,
  business_fiscal_id TEXT NOT NULL REFERENCES public.acube_sdi_business_registry_configs(fiscal_id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('active', 'passive')),
  type SMALLINT,
  marking TEXT,
  sdi_file_id TEXT,
  sdi_file_name TEXT,
  transmission_format TEXT,
  document_type TEXT,
  invoice_number TEXT,
  invoice_date DATE,
  currency TEXT DEFAULT 'EUR',
  total_amount NUMERIC(15, 2),
  to_pa BOOLEAN DEFAULT false,
  sender_vat TEXT,
  sender_country TEXT,
  sender_name TEXT,
  sender_uuid UUID,
  recipient_vat TEXT,
  recipient_name TEXT,
  recipient_uuid UUID,
  recipient_code TEXT,
  signed BOOLEAN DEFAULT false,
  legally_stored BOOLEAN DEFAULT false,
  downloaded BOOLEAN DEFAULT false,
  downloaded_at TIMESTAMPTZ,
  notifications JSONB,
  payload JSONB NOT NULL,
  acube_created_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_acube_sdi_inv_business ON public.acube_sdi_invoices(business_fiscal_id, invoice_date DESC);
CREATE INDEX idx_acube_sdi_inv_direction ON public.acube_sdi_invoices(direction);
CREATE INDEX idx_acube_sdi_inv_sender ON public.acube_sdi_invoices(sender_vat) WHERE direction = 'passive';
CREATE INDEX idx_acube_sdi_inv_marking ON public.acube_sdi_invoices(marking);
CREATE INDEX idx_acube_sdi_inv_sdi_file_id ON public.acube_sdi_invoices(sdi_file_id) WHERE sdi_file_id IS NOT NULL;

ALTER TABLE public.acube_sdi_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY acube_sdi_inv_read_authenticated ON public.acube_sdi_invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY acube_sdi_inv_service_write ON public.acube_sdi_invoices FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_acube_sdi_brc_updated BEFORE UPDATE ON public.acube_sdi_business_registry_configs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_acube_sdi_inv_updated BEFORE UPDATE ON public.acube_sdi_invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.acube_sdi_business_registry_configs IS 'Business Registry Configuration SDI A-Cube. 1 riga per ogni P.IVA gestita. Va creata via POST /business-registry-configurations prima di inviare/ricevere fatture.';
COMMENT ON TABLE public.acube_sdi_invoices IS 'Fatture FatturaPA gestite via A-Cube SDI. payload contiene il JSON completo. dedup su acube_uuid.';
