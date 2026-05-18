-- Migrazione 042: punto unico di difesa contro NULL da A-Cube.
--
-- Strategia: invece di iterare e fixare ogni colonna NOT NULL su 5+ tabelle
-- downstream (payables, electronic_invoices, suppliers...), normalizziamo
-- NEW.* DIRETTAMENTE sul trigger BEFORE INSERT della tabella sorgente
-- acube_sdi_invoices. Tutti i trigger AFTER INSERT vedranno valori sicuri.
--
-- Estende ensure_acube_business_registry_stub (già BEFORE INSERT) per fare
-- anche il populate dei campi mancanti:
--   - total_amount → 0 se NULL
--   - invoice_number → "[A-Cube xxxxxxxx]" se NULL/empty
--   - invoice_date → acube_created_at o current_date
--   - sender_name → sender_vat o "Cedente non specificato"
--   - sender_vat → "__UNKNOWN__" se mancante
--   - currency → "EUR"
--   - marking → "received"

CREATE OR REPLACE FUNCTION public.ensure_acube_business_registry_stub()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1) Auto-stub business_registry se business_fiscal_id manca
  IF NEW.business_fiscal_id IS NOT NULL THEN
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
  END IF;

  -- 2) Normalizza NEW.* per evitare NOT NULL violation downstream
  NEW.total_amount := coalesce(NEW.total_amount, 0);
  NEW.invoice_number := coalesce(
    nullif(trim(NEW.invoice_number), ''),
    '[A-Cube ' || substring(NEW.acube_uuid::text from 1 for 8) || ']'
  );
  NEW.invoice_date := coalesce(NEW.invoice_date, NEW.acube_created_at::date, current_date);
  NEW.sender_name := coalesce(
    nullif(trim(NEW.sender_name), ''),
    NEW.sender_vat,
    'Cedente non specificato'
  );
  NEW.sender_vat := coalesce(NEW.sender_vat, '__UNKNOWN__');
  NEW.currency := coalesce(NEW.currency, 'EUR');
  NEW.marking := coalesce(NEW.marking, 'received');

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
