-- ROLLBACK di NZ_ONLY_20260903_173_gruppofb_nc_ottobre_novembre.sql
-- Toglie i due terzi aggiunti della NC 4604 (righe create dalla migration, mai esistite prima) e ripristina le 3 righe dal backup.
BEGIN;

DELETE FROM public.payable_actions
WHERE note LIKE 'Allineamento GRUPPO FB alle scadenze ottobre/novembre di Sabrina (03/09/2026)%';

DELETE FROM public.payables
WHERE invoice_number = '4604' AND installment_number IN (2, 3)
  AND notes = 'Rata generata da ricalcolo piano RI.BA (03/09/2026, elenco Sabrina): terzo della NC 4604'
  AND id NOT IN (SELECT id FROM public._bkp_gruppofb_nc_ottobre_20260903);

UPDATE public.payables p SET
  gross_amount = b.gross_amount, net_amount = b.net_amount, vat_amount = b.vat_amount,
  due_date = b.due_date, original_due_date = b.original_due_date, installment_total = b.installment_total,
  payment_method = b.payment_method, notes = b.notes,
  status = b.status, amount_paid = b.amount_paid, payment_date = b.payment_date,
  closed_manually = b.closed_manually, manual_close_reason = b.manual_close_reason
FROM public._bkp_gruppofb_nc_ottobre_20260903 b
WHERE p.id = b.id;

COMMIT;
