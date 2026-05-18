-- Migrazione 043: acube_sdi_invoices.xml_content per XML FatturaPA originale
--
-- Contesto: InvoiceViewer (modal "vista PDF" della fattura) usa DOMParser
-- sul campo electronic_invoices.xml_content. Dopo il flusso A-Cube il
-- trigger sync_acube_sdi_passive_to_payable salvava NEW.payload::text
-- (JSON A-Cube) come xml_content → DOMParser falliva → PDF rotto.
--
-- Fix:
-- a) Nuova colonna acube_sdi_invoices.xml_content (TEXT, nullable)
-- b) Edge Function acube-sdi-sync-inbound v5 scarica anche l'XML reale
--    da A-Cube (/invoices/{uuid}/file e varianti) e lo popola.
-- c) Trigger preferisce xml_content reale; fallback su payload JSON solo
--    se XML non disponibile (compatibilità con vecchie sync).
-- d) ON CONFLICT (acube_uuid) DO UPDATE: se la fattura è già in
--    electronic_invoices ma xml_content era JSON, viene aggiornato al
--    nuovo XML al prossimo sync.

ALTER TABLE public.acube_sdi_invoices
  ADD COLUMN IF NOT EXISTS xml_content TEXT;

COMMENT ON COLUMN public.acube_sdi_invoices.xml_content IS
  'XML FatturaPA originale scaricato da A-Cube /invoices/{uuid}/file. NULL se non disponibile.';

CREATE OR REPLACE FUNCTION public.sync_acube_sdi_passive_to_payable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id UUID;
  v_supplier_id UUID;
  v_electronic_invoice_id UUID;
  v_default_terms INTEGER := 30;
  v_due_date DATE;
  v_safe_name TEXT;
  v_safe_invoice_number TEXT;
  v_safe_invoice_date DATE;
  v_xml_or_json TEXT;
BEGIN
  IF NEW.direction <> 'passive' THEN RETURN NEW; END IF;
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;
  IF v_company_id IS NULL THEN RETURN NEW; END IF;

  v_safe_name := coalesce(
    nullif(trim(NEW.sender_name), ''),
    NEW.sender_vat,
    'Cedente non specificato'
  );
  v_safe_invoice_number := coalesce(
    nullif(trim(NEW.invoice_number), ''),
    '[A-Cube ' || substring(NEW.acube_uuid::text from 1 for 8) || ']'
  );
  v_safe_invoice_date := coalesce(NEW.invoice_date, NEW.acube_created_at::date, current_date);

  -- Preferenza: XML reale se presente, altrimenti JSON payload (legacy)
  v_xml_or_json := coalesce(nullif(NEW.xml_content, ''), NEW.payload::text);

  SELECT id INTO v_supplier_id FROM public.suppliers
  WHERE company_id = v_company_id
    AND (partita_iva = NEW.sender_vat OR vat_number = NEW.sender_vat)
  LIMIT 1;

  IF v_supplier_id IS NULL THEN
    INSERT INTO public.suppliers (
      id, company_id, name, ragione_sociale, vat_number, partita_iva,
      nazione, source, is_active, payment_terms, payment_method
    ) VALUES (
      gen_random_uuid(), v_company_id, v_safe_name, v_safe_name,
      NEW.sender_vat, NEW.sender_vat, coalesce(NEW.sender_country, 'IT'),
      'acube_sdi', true, v_default_terms, 'bonifico_ordinario'
    ) RETURNING id INTO v_supplier_id;
  ELSE
    SELECT coalesce(payment_terms, default_payment_terms, 30) INTO v_default_terms
    FROM public.suppliers WHERE id = v_supplier_id;
  END IF;

  v_due_date := v_safe_invoice_date + (v_default_terms || ' days')::interval;

  INSERT INTO public.electronic_invoices (
    id, company_id, invoice_number, invoice_date, supplier_name, supplier_vat,
    gross_amount, due_date, sdi_id, sdi_status, tipo_documento, source,
    xml_content, acube_uuid, codice_destinatario, created_at
  ) VALUES (
    gen_random_uuid(), v_company_id, v_safe_invoice_number, v_safe_invoice_date,
    v_safe_name, NEW.sender_vat, NEW.total_amount, v_due_date,
    NEW.sdi_file_id, public._acube_marking_to_sdi_status(NEW.marking), NEW.document_type, 'api_acube_sdi',
    v_xml_or_json, NEW.acube_uuid, NEW.recipient_code, now()
  )
  ON CONFLICT (acube_uuid) DO UPDATE SET
    xml_content = EXCLUDED.xml_content
  RETURNING id INTO v_electronic_invoice_id;

  IF v_electronic_invoice_id IS NULL THEN
    SELECT id INTO v_electronic_invoice_id FROM public.electronic_invoices WHERE acube_uuid = NEW.acube_uuid;
  END IF;

  INSERT INTO public.payables (
    id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
    gross_amount, status, payment_method, electronic_invoice_id, acube_uuid,
    supplier_name, supplier_vat, created_at
  ) VALUES (
    gen_random_uuid(), v_company_id, v_supplier_id, v_safe_invoice_number, v_safe_invoice_date, v_due_date, v_due_date,
    coalesce(NEW.total_amount, 0), 'da_pagare'::payable_status, 'bonifico_ordinario'::payment_method,
    v_electronic_invoice_id, NEW.acube_uuid, v_safe_name, NEW.sender_vat, now()
  )
  ON CONFLICT (acube_uuid) DO NOTHING;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
