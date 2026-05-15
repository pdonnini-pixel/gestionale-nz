-- Migrazione 029 — Trigger sync A-Cube → bank_accounts/bank_transactions/payables
-- A. acube_accounts → bank_accounts (UPSERT) + acube_transactions → bank_transactions (NOT EXISTS dedup)
-- B. acube_sdi_invoices direction=passive → suppliers + electronic_invoices + payables

-- A.1
CREATE OR REPLACE FUNCTION public.sync_acube_account_to_bank_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company_id UUID; v_bank_account_id UUID;
BEGIN
  IF NOT NEW.enabled THEN RETURN NEW; END IF;
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;
  IF v_company_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.bank_accounts (
    id, company_id, bank_name, account_name, iban, account_type,
    currency, current_balance, is_active, is_manual,
    acube_account_uuid, balance_updated_at
  ) VALUES (
    gen_random_uuid(), v_company_id, NEW.provider_name, NEW.name, NEW.iban,
    CASE NEW.nature WHEN 'checking' THEN 'corrente' WHEN 'savings' THEN 'risparmio'
      WHEN 'credit_card' THEN 'carta_credito' WHEN 'debit_card' THEN 'carta_debito'
      WHEN 'card' THEN 'carta' WHEN 'loan' THEN 'finanziamento' WHEN 'mortgage' THEN 'mutuo'
      ELSE NEW.nature END,
    NEW.currency_code, NEW.balance, true, false, NEW.uuid, now()
  )
  ON CONFLICT (acube_account_uuid) DO UPDATE SET
    bank_name = EXCLUDED.bank_name, account_name = EXCLUDED.account_name, iban = EXCLUDED.iban,
    currency = EXCLUDED.currency, current_balance = EXCLUDED.current_balance,
    is_active = EXCLUDED.is_active, balance_updated_at = now()
  RETURNING id INTO v_bank_account_id;
  UPDATE public.acube_accounts SET bank_account_id = v_bank_account_id WHERE uuid = NEW.uuid;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_acube_account_to_bank ON public.acube_accounts;
CREATE TRIGGER trg_sync_acube_account_to_bank
  AFTER INSERT OR UPDATE OF enabled, balance, name, iban ON public.acube_accounts
  FOR EACH ROW EXECUTE FUNCTION public.sync_acube_account_to_bank_account();

-- A.2
CREATE OR REPLACE FUNCTION public.sync_acube_transaction_to_bank_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company_id UUID; v_bank_account_id UUID;
BEGIN
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;
  IF v_company_id IS NULL THEN RETURN NEW; END IF;
  SELECT bank_account_id INTO v_bank_account_id FROM public.acube_accounts WHERE uuid = NEW.acube_account_uuid;
  IF v_bank_account_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.bank_transactions (
    id, company_id, bank_account_id, transaction_date, value_date,
    amount, balance_after, description, currency, category,
    merchant_name, status, source, raw_data, acube_dedup_hash, created_at
  )
  SELECT gen_random_uuid(), v_company_id, v_bank_account_id, NEW.made_on, NEW.made_on,
    NEW.amount, NEW.closing_balance, NEW.description, NEW.currency_code, NEW.category,
    NULLIF(NEW.payee, ''), NEW.status, 'api_acube_ob', NEW.extra, NEW.dedup_hash, now()
  WHERE NOT EXISTS (SELECT 1 FROM public.bank_transactions WHERE acube_dedup_hash = NEW.dedup_hash);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_acube_tx_to_bank ON public.acube_transactions;
CREATE TRIGGER trg_sync_acube_tx_to_bank
  AFTER INSERT ON public.acube_transactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_acube_transaction_to_bank_transaction();

-- Helper marking → sdi_status enum
CREATE OR REPLACE FUNCTION public._acube_marking_to_sdi_status(p_marking TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE lower(coalesce(p_marking, ''))
    WHEN 'received' THEN 'RECEIVED' WHEN 'sent' THEN 'PENDING'
    WHEN 'delivered' THEN 'ACCEPTED' WHEN 'consegnato' THEN 'ACCEPTED' WHEN 'accepted' THEN 'ACCEPTED'
    WHEN 'rejected' THEN 'REJECTED' WHEN 'scartato' THEN 'REJECTED'
    ELSE 'PENDING'
  END;
$$;

-- B
CREATE OR REPLACE FUNCTION public.sync_acube_sdi_passive_to_payable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company_id UUID; v_supplier_id UUID; v_electronic_invoice_id UUID;
  v_default_terms INTEGER := 30; v_due_date DATE;
BEGIN
  IF NEW.direction <> 'passive' THEN RETURN NEW; END IF;
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;
  IF v_company_id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_supplier_id FROM public.suppliers
  WHERE company_id = v_company_id AND (partita_iva = NEW.sender_vat OR vat_number = NEW.sender_vat) LIMIT 1;

  IF v_supplier_id IS NULL THEN
    INSERT INTO public.suppliers (
      id, company_id, name, ragione_sociale, vat_number, partita_iva,
      nazione, source, is_active, payment_terms, payment_method
    ) VALUES (
      gen_random_uuid(), v_company_id, NEW.sender_name, NEW.sender_name,
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
    NEW.sender_name, NEW.sender_vat, NEW.total_amount, v_due_date,
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
    v_electronic_invoice_id, NEW.acube_uuid, NEW.sender_name, NEW.sender_vat, now()
  )
  ON CONFLICT (acube_uuid) DO NOTHING;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_acube_sdi_passive ON public.acube_sdi_invoices;
CREATE TRIGGER trg_sync_acube_sdi_passive
  AFTER INSERT ON public.acube_sdi_invoices
  FOR EACH ROW EXECUTE FUNCTION public.sync_acube_sdi_passive_to_payable();
