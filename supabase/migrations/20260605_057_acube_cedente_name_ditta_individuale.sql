-- 20260605_057_acube_cedente_name_ditta_individuale.sql
-- Fix nome fornitore "ditta individuale / persona fisica": arrivavano con
-- ragione_sociale = P.IVA perche' A-Cube mette la P.IVA in sender_name quando
-- la Denominazione (lato A-Cube) e' vuota. Il nome vero e' nell'XML FatturaPA,
-- nel CedentePrestatore: <Nome>+<Cognome> invece di <Denominazione>.
--
-- Stessa convenzione "Nome Cognome" gia' usata dai due parser XML:
--   netlify/functions/lib/sdi-sync-core.ts  (Denominazione || Nome+Cognome)
--   supabase/functions/sdi-sync/index.ts
--
-- NOTA SORGENTE XML (verificata sui dati reali NZ, 769 fatture passive):
--   acube_sdi_invoices.xml_content -> contiene <CedentePrestatore> in 769/769
--   acube_sdi_invoices.payload (jsonb) -> JSON A-Cube, NO CedentePrestatore (3/769)
-- Il trigger originale (migration 029) leggeva payload: sbagliato per i nomi.
-- Qui la sorgente e' coalesce(NEW.xml_content, NEW.payload::text). xml_content
-- e' valorizzato nello stesso INSERT (acube-cf-sync-invoices), quindi e'
-- disponibile nel trigger AFTER INSERT. Non distruttivo. Replicabile sui 3 tenant.

-- 1) Helper: estrae il nome del CedentePrestatore dall'XML FatturaPA.
--    Il [^>]* tollera prefissi namespace (es. ns2:Denominazione).
CREATE OR REPLACE FUNCTION public._acube_extract_cedente_name(p_xml text, p_fallback text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_block   text;
  v_denom   text;
  v_nome    text;
  v_cognome text;
BEGIN
  IF p_xml IS NULL THEN
    RETURN p_fallback;
  END IF;

  -- Isola il blocco CedentePrestatore (cedente = fornitore), escludendo il
  -- CessionarioCommittente (cessionario = noi) per non prenderne il nome.
  v_block := substring(p_xml from 'CedentePrestatore>(.*?)CessionarioCommittente');
  IF v_block IS NULL THEN
    RETURN p_fallback;
  END IF;

  v_denom := substring(v_block from '<[^>]*Denominazione>([^<]+)<');

  IF v_denom IS NULL OR btrim(v_denom) = '' THEN
    v_nome    := substring(v_block from '<[^>]*Nome>([^<]+)<');
    v_cognome := substring(v_block from '<[^>]*Cognome>([^<]+)<');
    v_denom   := btrim(coalesce(v_nome, '') || ' ' || coalesce(v_cognome, ''));
  END IF;

  RETURN coalesce(nullif(btrim(v_denom), ''), p_fallback);
END;
$$;

-- 2) Trigger passive: calcola v_name dal CedentePrestatore quando sender_name
--    e' assente / numerico / uguale alla P.IVA, e lo usa nei tre INSERT.
CREATE OR REPLACE FUNCTION public.sync_acube_sdi_passive_to_payable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company_id UUID; v_supplier_id UUID; v_electronic_invoice_id UUID;
  v_default_terms INTEGER := 30; v_due_date DATE; v_name TEXT;
BEGIN
  IF NEW.direction <> 'passive' THEN RETURN NEW; END IF;
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;
  IF v_company_id IS NULL THEN RETURN NEW; END IF;

  -- Nome fornitore: sender_name se valido, altrimenti dal CedentePrestatore XML.
  v_name := NEW.sender_name;
  IF v_name IS NULL OR v_name ~ '^[0-9]+$' OR v_name = NEW.sender_vat THEN
    v_name := public._acube_extract_cedente_name(coalesce(NEW.xml_content, NEW.payload::text), NEW.sender_vat);
  END IF;

  SELECT id INTO v_supplier_id FROM public.suppliers
  WHERE company_id = v_company_id AND (partita_iva = NEW.sender_vat OR vat_number = NEW.sender_vat) LIMIT 1;

  IF v_supplier_id IS NULL THEN
    INSERT INTO public.suppliers (
      id, company_id, name, ragione_sociale, vat_number, partita_iva,
      nazione, source, is_active, payment_terms, payment_method
    ) VALUES (
      gen_random_uuid(), v_company_id, v_name, v_name,
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
    v_name, NEW.sender_vat, NEW.total_amount, v_due_date,
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
    v_electronic_invoice_id, NEW.acube_uuid, v_name, NEW.sender_vat, now()
  )
  ON CONFLICT (acube_uuid) DO NOTHING;

  RETURN NEW;
END; $$;

-- Trigger invariato (riusa la funzione aggiornata). Ricreato per idempotenza.
DROP TRIGGER IF EXISTS trg_sync_acube_sdi_passive ON public.acube_sdi_invoices;
CREATE TRIGGER trg_sync_acube_sdi_passive
  AFTER INSERT ON public.acube_sdi_invoices
  FOR EACH ROW EXECUTE FUNCTION public.sync_acube_sdi_passive_to_payable();
