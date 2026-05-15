-- Migrazione 030 — Sync acube_sdi_invoices direction='active' → electronic_invoices
-- Le fatture attive emesse generano solo electronic_invoice (no payable, è incassi non pagamenti).

CREATE OR REPLACE FUNCTION public.sync_acube_sdi_active_to_einvoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company_id UUID; v_due_date DATE;
BEGIN
  IF NEW.direction <> 'active' THEN RETURN NEW; END IF;
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;
  IF v_company_id IS NULL THEN RETURN NEW; END IF;

  v_due_date := NEW.invoice_date + interval '30 days';

  INSERT INTO public.electronic_invoices (
    id, company_id, invoice_number, invoice_date, supplier_name, supplier_vat,
    gross_amount, due_date, sdi_id, sdi_status, tipo_documento, source,
    xml_content, acube_uuid, codice_destinatario, created_at
  ) VALUES (
    gen_random_uuid(), v_company_id, NEW.invoice_number, NEW.invoice_date,
    NEW.recipient_name, NEW.recipient_vat,  -- per attive: recipient = cliente
    NEW.total_amount, v_due_date,
    NEW.sdi_file_id, public._acube_marking_to_sdi_status(NEW.marking), NEW.document_type, 'api_acube_sdi',
    NEW.payload::text, NEW.acube_uuid, NEW.recipient_code, now()
  )
  ON CONFLICT (acube_uuid) DO NOTHING;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_acube_sdi_active ON public.acube_sdi_invoices;
CREATE TRIGGER trg_sync_acube_sdi_active
  AFTER INSERT ON public.acube_sdi_invoices
  FOR EACH ROW EXECUTE FUNCTION public.sync_acube_sdi_active_to_einvoice();
