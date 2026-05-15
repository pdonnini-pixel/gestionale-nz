-- Migrazione 027 — Log webhook SDI A-Cube
-- Separato da OB perché eventi diversi (supplier-invoice, customer-invoice-notification, ecc).
-- signature_valid traccia esito verifica Ed25519 IETF HTTP Message Signatures.

CREATE TABLE IF NOT EXISTS public.acube_sdi_webhook_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  raw_headers JSONB,
  signature_valid BOOLEAN,
  processed BOOLEAN NOT NULL DEFAULT false,
  processing_error TEXT,
  invoice_uuid UUID,
  business_fiscal_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_acube_sdi_wh_event ON public.acube_sdi_webhook_log(event, received_at DESC);
CREATE INDEX idx_acube_sdi_wh_unprocessed ON public.acube_sdi_webhook_log(processed, received_at) WHERE NOT processed;
CREATE INDEX idx_acube_sdi_wh_invoice ON public.acube_sdi_webhook_log(invoice_uuid) WHERE invoice_uuid IS NOT NULL;

ALTER TABLE public.acube_sdi_webhook_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY acube_sdi_wh_read_authenticated ON public.acube_sdi_webhook_log FOR SELECT TO authenticated USING (true);
CREATE POLICY acube_sdi_wh_service_write ON public.acube_sdi_webhook_log FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.acube_sdi_webhook_log IS 'Audit webhook A-Cube SDI ricevuti (supplier-invoice, customer-invoice-notification, ecc). signature_valid traccia esito verifica Ed25519 (null = verifica pending in backlog).';
