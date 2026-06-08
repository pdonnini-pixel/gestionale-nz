-- 20260603_054_nz_cleanup_active_invoices_misrouted.sql
-- PARTE C — One-off SOLO NZ (xfvfxsvqpnpvibgeqpqp). NON eseguire su Made/Zago
-- (non hanno ancora dati cassetto fiscale).
-- Contesto: lo scarico one-shot del 2026-06-03 (prima del fix 053) ha instradato
-- erroneamente le 17 fatture ATTIVE in electronic_invoices, generando 17 payables
-- fantasma via il ponte fn_invoice_to_payable. Questo script:
--   1) backup delle righe toccate in *_bkp_20260603 (gia' creato in sessione);
--   2) sposta le 17 attive in active_invoices;
--   3) elimina le 17 e-invoices attive + 17 payables fantasma collegate.
-- Insert/delete mirati, nessun TRUNCATE. Eseguito via MCP il 2026-06-03; qui per tracciabilita'.

-- 1) BACKUP
CREATE TABLE IF NOT EXISTS public.electronic_invoices_bkp_20260603 AS
  SELECT * FROM public.electronic_invoices
  WHERE source='api_acube_sdi' AND created_at::date='2026-06-03';
CREATE TABLE IF NOT EXISTS public.payables_bkp_20260603 AS
  SELECT * FROM public.payables WHERE created_at::date='2026-06-03';

-- 2) INSERT 17 attive in active_invoices (dedup su acube_uuid)
INSERT INTO public.active_invoices (
  id, company_id, invoice_number, invoice_date, tipo_documento,
  client_name, client_vat, codice_destinatario,
  total_amount, sdi_id, sdi_status, xml_content, acube_uuid, created_at
)
SELECT
  gen_random_uuid(), (SELECT id FROM public.companies LIMIT 1),
  coalesce(nullif(trim(s.invoice_number),''), '[A-Cube '||substring(s.acube_uuid::text from 1 for 8)||']'),
  coalesce(s.invoice_date, s.acube_created_at::date, current_date),
  coalesce(s.document_type, 'TD01'),
  coalesce(nullif(trim(s.recipient_name),''), s.recipient_vat, 'Cliente non specificato'),
  s.recipient_vat, s.recipient_code,
  coalesce(s.total_amount, 0),
  s.sdi_file_id,
  CASE lower(coalesce(s.marking,''))
    WHEN 'sent' THEN 'SENT' WHEN 'delivered' THEN 'DELIVERED'
    WHEN 'accepted' THEN 'ACCEPTED' WHEN 'rejected' THEN 'REJECTED'
    WHEN 'deposited' THEN 'DEPOSITED' ELSE 'SENT' END,
  coalesce(nullif(s.xml_content,''), s.payload::text),
  s.acube_uuid, now()
FROM public.acube_sdi_invoices s
WHERE s.direction='active'
ON CONFLICT (acube_uuid) WHERE acube_uuid IS NOT NULL DO NOTHING;

-- 3) DELETE 17 payables fantasma (collegate alle e-invoices attive) poi 17 e-invoices attive
DELETE FROM public.payables
WHERE electronic_invoice_id IN (
  SELECT id FROM public.electronic_invoices
  WHERE acube_uuid IN (SELECT acube_uuid FROM public.acube_sdi_invoices WHERE direction='active')
);

DELETE FROM public.electronic_invoices
WHERE acube_uuid IN (SELECT acube_uuid FROM public.acube_sdi_invoices WHERE direction='active');
