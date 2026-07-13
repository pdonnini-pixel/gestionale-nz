-- Migrazione 090 — Riallineamento repo↔DB: trigger fatture attive A-Cube
--
-- CONTESTO
-- La migration 030 (20260515_030_acube_sdi_active_sync.sql) definiva
-- sync_acube_sdi_active_to_einvoice() in modo che inserisse in
-- public.electronic_invoices. In produzione la funzione è stata poi
-- aggiornata (direttamente sul DB) per inserire invece in
-- public.active_invoices — che è la tabella letta dal tab "Attive" della
-- pagina Fatturazione. Il repo era quindi disallineato dal DB reale.
--
-- Verifica (2026-07-13) su tutti e 3 i tenant NZ/Made/Zago: la funzione
-- live scrive già in active_invoices. Questa migration NON cambia il
-- comportamento dei tenant esistenti (CREATE OR REPLACE con corpo identico
-- a produzione): serve a rendere il repo fedele al DB e a garantire che
-- eventuali tenant nuovi ricevano la versione corretta. Supera la 030.
--
-- Additiva e idempotente. Nessuna perdita dati.

-- 1. Colonna + vincolo unico usati come conflict target (idempotenti).
ALTER TABLE public.active_invoices ADD COLUMN IF NOT EXISTS acube_uuid uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'active_invoices' AND indexname = 'active_invoices_acube_uuid_key'
  ) THEN
    ALTER TABLE public.active_invoices
      ADD CONSTRAINT active_invoices_acube_uuid_key UNIQUE (acube_uuid);
  END IF;
END $$;

-- 2. Funzione allineata alla versione di produzione: scrive in active_invoices.
CREATE OR REPLACE FUNCTION public.sync_acube_sdi_active_to_einvoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_company_id UUID; v_imp numeric; v_iva numeric;
BEGIN
  IF NEW.direction <> 'active' THEN RETURN NEW; END IF;
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;
  IF v_company_id IS NULL THEN RETURN NEW; END IF;
  SELECT imponibile, imposta INTO v_imp, v_iva
    FROM public._acube_xml_imponibile_iva(nullif(NEW.xml_content, ''));

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

-- 3. Trigger (ricreato idempotente).
DROP TRIGGER IF EXISTS trg_sync_acube_sdi_active ON public.acube_sdi_invoices;
CREATE TRIGGER trg_sync_acube_sdi_active
  AFTER INSERT ON public.acube_sdi_invoices
  FOR EACH ROW EXECUTE FUNCTION public.sync_acube_sdi_active_to_einvoice();
