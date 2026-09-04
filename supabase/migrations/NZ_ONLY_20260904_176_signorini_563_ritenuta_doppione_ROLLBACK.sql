-- =============================================================================
-- ROLLBACK NZ_ONLY 176 — riporta le due righe SIGNORINI e la fattura 563
-- allo stato del 04/09/2026 prima del fix, dai backup.
-- =============================================================================

BEGIN;

-- prima si libera l'acube_uuid sulla riga assorbita (indice unico)
UPDATE public.payables p SET
  invoice_number = b.invoice_number, invoice_date = b.invoice_date, due_date = b.due_date,
  original_due_date = b.original_due_date, payment_date = b.payment_date,
  electronic_invoice_id = b.electronic_invoice_id, acube_uuid = b.acube_uuid,
  gross_amount = b.gross_amount, net_amount = b.net_amount, vat_amount = b.vat_amount,
  withholding_amount = b.withholding_amount, amount_paid = b.amount_paid,
  status = b.status, payment_method = b.payment_method, payment_method_code = b.payment_method_code,
  payment_method_label = b.payment_method_label, manual_close_reason = b.manual_close_reason, notes = b.notes
FROM public._bkp_signorini_563_20260904 b
WHERE p.id = b.id AND b.id = 'd4b0648c-a818-416e-a65f-8ea6f2dc37d8';

UPDATE public.payables p SET
  invoice_number = b.invoice_number, invoice_date = b.invoice_date, due_date = b.due_date,
  original_due_date = b.original_due_date, payment_date = b.payment_date,
  electronic_invoice_id = b.electronic_invoice_id, acube_uuid = b.acube_uuid,
  gross_amount = b.gross_amount, net_amount = b.net_amount, vat_amount = b.vat_amount,
  withholding_amount = b.withholding_amount, amount_paid = b.amount_paid,
  status = b.status, payment_method = b.payment_method, payment_method_code = b.payment_method_code,
  payment_method_label = b.payment_method_label, manual_close_reason = b.manual_close_reason, notes = b.notes
FROM public._bkp_signorini_563_20260904 b
WHERE p.id = b.id AND b.id = 'c713508b-9148-4497-8f8f-59ca66cb3683';

UPDATE public.electronic_invoices e SET withholding_amount = b.withholding_amount
FROM public._bkp_signorini_563_ei_20260904 b WHERE e.id = b.id;

DELETE FROM public.payable_actions
 WHERE operator_name = 'Fix ritenuta 04/09'
   AND payable_id IN ('c713508b-9148-4497-8f8f-59ca66cb3683','d4b0648c-a818-416e-a65f-8ea6f2dc37d8');

COMMIT;
