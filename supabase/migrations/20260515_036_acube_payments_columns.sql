-- Migrazione 036 — Estensione payment_batch_items per pagamenti A-Cube outbound
-- Pattern: 1 chiamata POST /payments/send/sepa per item → A-Cube ritorna URL autorizzazione
-- Webhook payment success → marca item completato (handler Edge Function in Fase successiva).

ALTER TABLE public.payment_batch_items
  ADD COLUMN IF NOT EXISTS acube_payment_uuid UUID,
  ADD COLUMN IF NOT EXISTS acube_authorize_url TEXT,
  ADD COLUMN IF NOT EXISTS acube_status TEXT,
  ADD COLUMN IF NOT EXISTS acube_payment_provider TEXT;

CREATE INDEX IF NOT EXISTS idx_pbi_acube_uuid ON public.payment_batch_items(acube_payment_uuid) WHERE acube_payment_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pbi_acube_status ON public.payment_batch_items(acube_status) WHERE acube_status IS NOT NULL;

ALTER TABLE public.payment_batches
  ADD COLUMN IF NOT EXISTS acube_initiated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acube_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.payment_batch_items.acube_payment_uuid IS 'UUID payment A-Cube ritornato da POST /payments/send/sepa';
COMMENT ON COLUMN public.payment_batch_items.acube_authorize_url IS 'URL su cui utente autorizza il pagamento PSD2 (SCA sulla banca)';
COMMENT ON COLUMN public.payment_batch_items.acube_status IS 'Stato A-Cube: initiated, authorized, pending, success, failed, expired';
