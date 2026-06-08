-- 20260603_053_route_acube_sdi_active_to_active_invoices.sql
-- PARTE B — Instradamento fatture A-Cube per direzione.
-- ATTIVA (NZ = cedente/sender) -> SOLO public.active_invoices.
--   NIENTE electronic_invoices (che innescherebbe fn_invoice_to_payable -> payable),
--   niente scheda fornitore, niente payable.
-- PASSIVA (NZ = recipient) -> resta invariata: sync_acube_sdi_passive_to_payable()
--   (electronic_invoices + supplier + payable).
-- Replicabile su tutti e 3 i tenant (NZ/Made/Zago). Non distruttivo.

-- Dedup idempotente per active_invoices (additivo)
ALTER TABLE public.active_invoices ADD COLUMN IF NOT EXISTS acube_uuid uuid;
CREATE UNIQUE INDEX IF NOT EXISTS active_invoices_acube_uuid_key
  ON public.active_invoices (acube_uuid) WHERE acube_uuid IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_acube_sdi_active_to_einvoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_company_id UUID;
BEGIN
  IF NEW.direction <> 'active' THEN RETURN NEW; END IF;
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;
  IF v_company_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.active_invoices (
    id, company_id, invoice_number, invoice_date, tipo_documento,
    client_name, client_vat, codice_destinatario,
    total_amount, sdi_id, sdi_status, xml_content, acube_uuid, created_at
  ) VALUES (
    gen_random_uuid(), v_company_id,
    coalesce(nullif(trim(NEW.invoice_number),''), '[A-Cube '||substring(NEW.acube_uuid::text from 1 for 8)||']'),
    coalesce(NEW.invoice_date, NEW.acube_created_at::date, current_date),
    coalesce(NEW.document_type, 'TD01'),
    coalesce(nullif(trim(NEW.recipient_name),''), NEW.recipient_vat, 'Cliente non specificato'),
    NEW.recipient_vat, NEW.recipient_code,
    coalesce(NEW.total_amount, 0),
    NEW.sdi_file_id,
    CASE lower(coalesce(NEW.marking,''))
      WHEN 'sent' THEN 'SENT' WHEN 'delivered' THEN 'DELIVERED'
      WHEN 'accepted' THEN 'ACCEPTED' WHEN 'rejected' THEN 'REJECTED'
      WHEN 'deposited' THEN 'DEPOSITED' ELSE 'SENT' END,
    coalesce(nullif(NEW.xml_content,''), NEW.payload::text),
    NEW.acube_uuid, now()
  )
  ON CONFLICT (acube_uuid) WHERE acube_uuid IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$function$;
