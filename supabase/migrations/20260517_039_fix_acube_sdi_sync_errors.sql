-- Migrazione 039: fix 4 errori sync A-Cube SDI pull inbound
--
-- Contesto: il primo run di acube-sdi-sync-inbound v4 ha trovato 10 fatture
-- passive su A-Cube sandbox NZ. 6 erano già in DB (skipped). 4 hanno
-- fallito l'insert con 2 cause:
--
-- 1) 1 fattura: null value in column "name" of relation "suppliers"
--    → A-Cube ha consegnato un cedente senza denominazione, e il trigger
--      sync_acube_sdi_passive_to_payable non aveva fallback.
--
-- 2) 3 fatture: FK violation acube_sdi_invoices_business_fiscal_id_fkey
--    → A-Cube ha consegnato fatture passive per P.IVA destinatario NON
--      presente in acube_sdi_business_registry_configs. La FK è ON DELETE
--      CASCADE, troppo rigida per pull bulk.
--
-- Fix:
-- a) Trigger BEFORE INSERT su acube_sdi_invoices: auto-crea stub
--    in acube_sdi_business_registry_configs se business_fiscal_id manca.
--    Stub è enabled=false così non vengono inviate/ricevute fatture finché
--    qualcuno non lo abilita esplicitamente.
-- b) Fix trigger sync_acube_sdi_passive_to_payable: fallback nome
--    supplier su VAT o "Cedente non specificato" se sender_name è null/empty.

CREATE OR REPLACE FUNCTION public.ensure_acube_business_registry_stub()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.business_fiscal_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.acube_sdi_business_registry_configs (
    uuid, fiscal_id, business_name, email, type, stage, enabled
  ) VALUES (
    gen_random_uuid(),
    NEW.business_fiscal_id,
    '[Auto-stub] ' || NEW.business_fiscal_id,
    'autostub@gestionalenz.local',
    'company',
    coalesce((SELECT stage FROM public.acube_sdi_business_registry_configs LIMIT 1), 'sandbox'),
    false
  )
  ON CONFLICT (fiscal_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_acube_br_stub ON public.acube_sdi_invoices;
CREATE TRIGGER trg_ensure_acube_br_stub
BEFORE INSERT ON public.acube_sdi_invoices
FOR EACH ROW EXECUTE FUNCTION public.ensure_acube_business_registry_stub();

-- ============================================================
-- Fix trigger sync passive: fallback nome supplier
-- ============================================================
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
BEGIN
  IF NEW.direction <> 'passive' THEN RETURN NEW; END IF;
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;
  IF v_company_id IS NULL THEN RETURN NEW; END IF;

  -- Fallback nome: sender_name → sender_vat → 'Cedente non specificato'
  v_safe_name := coalesce(
    nullif(trim(NEW.sender_name), ''),
    NEW.sender_vat,
    'Cedente non specificato'
  );

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

  v_due_date := NEW.invoice_date + (v_default_terms || ' days')::interval;

  INSERT INTO public.electronic_invoices (
    id, company_id, invoice_number, invoice_date, supplier_name, supplier_vat,
    gross_amount, due_date, sdi_id, sdi_status, tipo_documento, source,
    xml_content, acube_uuid, codice_destinatario, created_at
  ) VALUES (
    gen_random_uuid(), v_company_id, NEW.invoice_number, NEW.invoice_date,
    v_safe_name, NEW.sender_vat, NEW.total_amount, v_due_date,
    NEW.sdi_file_id, public._acube_marking_to_sdi_status(NEW.marking), NEW.document_type, 'api_acube_sdi',
    NEW.payload::text, NEW.acube_uuid, NEW.recipient_code, now()
  )
  ON CONFLICT (acube_uuid) DO NOTHING
  RETURNING id INTO v_electronic_invoice_id;

  IF v_electronic_invoice_id IS NULL THEN
    SELECT id INTO v_electronic_invoice_id FROM public.electronic_invoices WHERE acube_uuid = NEW.acube_uuid;
  END IF;

  INSERT INTO public.payables (
    id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
    gross_amount, status, payment_method, electronic_invoice_id, acube_uuid,
    supplier_name, supplier_vat, created_at
  ) VALUES (
    gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_due_date, v_due_date,
    NEW.total_amount, 'da_pagare'::payable_status, 'bonifico_ordinario'::payment_method,
    v_electronic_invoice_id, NEW.acube_uuid, v_safe_name, NEW.sender_vat, now()
  )
  ON CONFLICT (acube_uuid) DO NOTHING;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
