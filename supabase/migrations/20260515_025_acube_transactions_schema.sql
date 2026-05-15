-- Migrazione 025 — Schema A-Cube transactions (con trigger dedup invece di generated column)
-- Tabella raw: tutto come arriva da A-Cube + dedup_hash composito.
-- transactionId di A-Cube NON è stabile su disconnect/reconnect: la dedup vera
-- usa euristica composita (end_to_end_id + made_on + amount + description + account_uuid).

CREATE TABLE IF NOT EXISTS public.acube_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acube_account_uuid UUID NOT NULL REFERENCES public.acube_accounts(uuid) ON DELETE CASCADE,
  acube_transaction_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('posted', 'pending')),
  made_on DATE NOT NULL,
  amount NUMERIC(15, 2) NOT NULL,
  currency_code TEXT NOT NULL,
  description TEXT,
  additional TEXT,
  category TEXT,
  categorization_confidence NUMERIC(3, 2),
  duplicated BOOLEAN DEFAULT false,
  end_to_end_id TEXT,
  merchant_id TEXT,
  mcc TEXT,
  payee TEXT,
  payer TEXT,
  closing_balance NUMERIC(15, 2),
  posting_date TIMESTAMPTZ,
  extra JSONB,
  dedup_hash TEXT NOT NULL,
  acube_created_at TIMESTAMPTZ,
  acube_updated_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (acube_account_uuid, dedup_hash)
);

CREATE INDEX idx_acube_tx_account ON public.acube_transactions(acube_account_uuid, made_on DESC);
CREATE INDEX idx_acube_tx_status ON public.acube_transactions(status);
CREATE INDEX idx_acube_tx_made_on ON public.acube_transactions(made_on DESC);
CREATE INDEX idx_acube_tx_category ON public.acube_transactions(category) WHERE category IS NOT NULL;

CREATE OR REPLACE FUNCTION public.acube_tx_set_dedup_hash()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.dedup_hash := md5(
    coalesce(NEW.end_to_end_id, '') || '|' ||
    NEW.made_on::text || '|' ||
    NEW.amount::text || '|' ||
    coalesce(NEW.description, '') || '|' ||
    NEW.acube_account_uuid::text
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_acube_tx_dedup
  BEFORE INSERT OR UPDATE OF end_to_end_id, made_on, amount, description, acube_account_uuid
  ON public.acube_transactions
  FOR EACH ROW EXECUTE FUNCTION public.acube_tx_set_dedup_hash();

ALTER TABLE public.acube_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY acube_tx_read_authenticated ON public.acube_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY acube_tx_service_write ON public.acube_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_acube_tx_updated BEFORE UPDATE ON public.acube_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.acube_transactions IS 'Transazioni raw A-Cube. dedup_hash auto-popolato da trigger (md5 di end_to_end_id+made_on+amount+description+account_uuid). transactionId NON è stabile.';
