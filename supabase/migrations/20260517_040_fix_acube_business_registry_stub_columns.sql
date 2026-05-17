-- Migrazione 040: fix trigger ensure_acube_business_registry_stub
--
-- Errore precedente (migr 039): assumevo colonne 'uuid', 'type', 'enabled'
-- che NON esistono in acube_sdi_business_registry_configs.
--
-- Schema reale della tabella:
--   fiscal_id (PK, NOT NULL)
--   vat_number (NOT NULL)
--   name (NOT NULL)
--   email (NULL)
--   stage (NOT NULL)
--   customer_invoice_enabled / supplier_invoice_enabled / receipts_enabled /
--     legal_storage_active / apply_signature (boolean flag per canale)
--   raw_config (jsonb)
--   created_at / updated_at
--
-- Lo stub auto-creato è disabilitato su tutti i canali. Sabrina/Veronica
-- vedranno la fattura come passive ricevuta ma il business stub resta
-- "non operativo" finché qualcuno non lo configura esplicitamente.

CREATE OR REPLACE FUNCTION public.ensure_acube_business_registry_stub()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.business_fiscal_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.acube_sdi_business_registry_configs (
    fiscal_id, vat_number, name, email, stage,
    customer_invoice_enabled, supplier_invoice_enabled,
    receipts_enabled, legal_storage_active
  ) VALUES (
    NEW.business_fiscal_id,
    NEW.business_fiscal_id,
    '[Auto-stub] ' || NEW.business_fiscal_id,
    'autostub@gestionalenz.local',
    coalesce((SELECT stage FROM public.acube_sdi_business_registry_configs LIMIT 1), 'sandbox'),
    false, false, false, false
  )
  ON CONFLICT (fiscal_id) DO NOTHING;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
