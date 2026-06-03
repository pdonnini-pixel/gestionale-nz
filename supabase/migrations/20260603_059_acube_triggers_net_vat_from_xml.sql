-- 20260603_059_acube_triggers_net_vat_from_xml.sql
-- PARTE 2: i trigger di instradamento popolano net/vat (imponibile/IVA) dall'XML
-- FatturaPA al momento dell'inserimento, cosi' i download futuri arrivano gia'
-- completi. Replicabile su NZ/Made/Zago. Non distruttivo.

CREATE OR REPLACE FUNCTION public._acube_xml_imponibile_iva(p_xml text)
 RETURNS TABLE(imponibile numeric, imposta numeric)
 LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v xml;
BEGIN
  imponibile := NULL; imposta := NULL;
  IF p_xml IS NULL OR position('<FatturaElettronica' in p_xml) = 0 THEN RETURN NEXT; RETURN; END IF;
  BEGIN v := p_xml::xml; EXCEPTION WHEN OTHERS THEN RETURN NEXT; RETURN; END;
  SELECT COALESCE(sum(x::numeric),0) INTO imponibile FROM unnest(xpath('//*[local-name()="DatiRiepilogo"]/*[local-name()="ImponibileImporto"]/text()', v)::text[]) x;
  SELECT COALESCE(sum(x::numeric),0) INTO imposta FROM unnest(xpath('//*[local-name()="DatiRiepilogo"]/*[local-name()="Imposta"]/text()', v)::text[]) x;
  RETURN NEXT;
END;
$function$;

-- PASSIVE: + net_amount/vat_amount da XML
CREATE OR REPLACE FUNCTION public.sync_acube_sdi_passive_to_payable()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id UUID; v_supplier_id UUID; v_electronic_invoice_id UUID;
  v_default_terms INTEGER := 30; v_due_date DATE;
  v_safe_name TEXT; v_safe_invoice_number TEXT; v_safe_invoice_date DATE; v_xml_or_json TEXT;
  v_imp numeric; v_iva numeric;
BEGIN
  IF NEW.direction <> 'passive' THEN RETURN NEW; END IF;
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;
  IF v_company_id IS NULL THEN RETURN NEW; END IF;
  v_safe_name := coalesce(nullif(trim(NEW.sender_name), ''), NEW.sender_vat, 'Cedente non specificato');
  v_safe_invoice_number := coalesce(nullif(trim(NEW.invoice_number), ''), '[A-Cube ' || substring(NEW.acube_uuid::text from 1 for 8) || ']');
  v_safe_invoice_date := coalesce(NEW.invoice_date, NEW.acube_created_at::date, current_date);
  v_xml_or_json := coalesce(nullif(NEW.xml_content, ''), NEW.payload::text);
  SELECT imponibile, imposta INTO v_imp, v_iva FROM public._acube_xml_imponibile_iva(nullif(NEW.xml_content, ''));
  SELECT id INTO v_supplier_id FROM public.suppliers
  WHERE company_id = v_company_id AND (partita_iva = NEW.sender_vat OR vat_number = NEW.sender_vat) LIMIT 1;
  IF v_supplier_id IS NULL THEN
    INSERT INTO public.suppliers (id, company_id, name, ragione_sociale, vat_number, partita_iva, nazione, source, is_active, payment_terms, payment_method)
    VALUES (gen_random_uuid(), v_company_id, v_safe_name, v_safe_name, NEW.sender_vat, NEW.sender_vat, coalesce(NEW.sender_country, 'IT'), 'acube_sdi', true, v_default_terms, 'bonifico_ordinario')
    RETURNING id INTO v_supplier_id;
  ELSE
    SELECT coalesce(payment_terms, default_payment_terms, 30) INTO v_default_terms FROM public.suppliers WHERE id = v_supplier_id;
  END IF;
  v_due_date := v_safe_invoice_date + (v_default_terms || ' days')::interval;
  INSERT INTO public.electronic_invoices (
    id, company_id, invoice_number, invoice_date, supplier_name, supplier_vat,
    gross_amount, net_amount, vat_amount, due_date, sdi_id, sdi_status, tipo_documento, source,
    xml_content, acube_uuid, codice_destinatario, created_at
  ) VALUES (
    gen_random_uuid(), v_company_id, v_safe_invoice_number, v_safe_invoice_date,
    v_safe_name, NEW.sender_vat, NEW.total_amount, v_imp, v_iva, v_due_date,
    NEW.sdi_file_id, public._acube_marking_to_sdi_status(NEW.marking), NEW.document_type, 'api_acube_sdi',
    v_xml_or_json, NEW.acube_uuid, NEW.recipient_code, now()
  )
  ON CONFLICT (acube_uuid) DO UPDATE SET
    xml_content = EXCLUDED.xml_content,
    net_amount = COALESCE(public.electronic_invoices.net_amount, EXCLUDED.net_amount),
    vat_amount = COALESCE(public.electronic_invoices.vat_amount, EXCLUDED.vat_amount)
  RETURNING id INTO v_electronic_invoice_id;
  IF v_electronic_invoice_id IS NULL THEN
    SELECT id INTO v_electronic_invoice_id FROM public.electronic_invoices WHERE acube_uuid = NEW.acube_uuid;
  END IF;
  INSERT INTO public.payables (
    id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
    gross_amount, status, payment_method, electronic_invoice_id, acube_uuid, supplier_name, supplier_vat, created_at
  ) VALUES (
    gen_random_uuid(), v_company_id, v_supplier_id, v_safe_invoice_number, v_safe_invoice_date, v_due_date, v_due_date,
    coalesce(NEW.total_amount, 0), 'da_pagare'::payable_status, 'bonifico_ordinario'::payment_method,
    v_electronic_invoice_id, NEW.acube_uuid, v_safe_name, NEW.sender_vat, now()
  )
  ON CONFLICT (acube_uuid) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- ACTIVE: + taxable_amount/vat_amount da XML
CREATE OR REPLACE FUNCTION public.sync_acube_sdi_active_to_einvoice()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_company_id UUID; v_imp numeric; v_iva numeric;
BEGIN
  IF NEW.direction <> 'active' THEN RETURN NEW; END IF;
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;
  IF v_company_id IS NULL THEN RETURN NEW; END IF;
  SELECT imponibile, imposta INTO v_imp, v_iva FROM public._acube_xml_imponibile_iva(nullif(NEW.xml_content, ''));
  INSERT INTO public.active_invoices (
    id, company_id, invoice_number, invoice_date, tipo_documento,
    client_name, client_vat, codice_destinatario,
    total_amount, taxable_amount, vat_amount, sdi_id, sdi_status, xml_content, acube_uuid, created_at
  ) VALUES (
    gen_random_uuid(), v_company_id,
    coalesce(nullif(trim(NEW.invoice_number),''), '[A-Cube '||substring(NEW.acube_uuid::text from 1 for 8)||']'),
    coalesce(NEW.invoice_date, NEW.acube_created_at::date, current_date),
    coalesce(NEW.document_type, 'TD01'),
    coalesce(nullif(trim(NEW.recipient_name),''), NEW.recipient_vat, 'Cliente non specificato'),
    NEW.recipient_vat, NEW.recipient_code,
    coalesce(NEW.total_amount, 0), v_imp, v_iva,
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
