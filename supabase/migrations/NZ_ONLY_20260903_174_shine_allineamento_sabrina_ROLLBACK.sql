-- ROLLBACK di NZ_ONLY_20260903_174_shine_allineamento_sabrina.sql
-- Toglie le 8 rate aggiunte (righe create dalla migration, mai esistite prima) e ripristina le 10 righe dal backup.
BEGIN;

DELETE FROM public.payable_actions
WHERE note LIKE 'Allineamento SHINE agli elenchi scadenze di Sabrina (03/09/2026)%';

DELETE FROM public.payables
WHERE supplier_name ILIKE 'SHINE%' AND invoice_number IN ('1369/26','1381/26','1410/26','1418/26') AND installment_number IN (2, 3)
  AND notes = 'Rata generata da ricalcolo piano RI.BA (03/09/2026, elenco scadenze SHINE di Sabrina)'
  AND id NOT IN (SELECT id FROM public._bkp_shine_allineamento_sabrina_20260903);

UPDATE public.payables p SET
  gross_amount = b.gross_amount, net_amount = b.net_amount, vat_amount = b.vat_amount,
  due_date = b.due_date, original_due_date = b.original_due_date, installment_number = b.installment_number, installment_total = b.installment_total,
  payment_method = b.payment_method, postponed_to = b.postponed_to, postpone_count = b.postpone_count, notes = b.notes,
  status = b.status, amount_paid = b.amount_paid, payment_date = b.payment_date,
  closed_manually = b.closed_manually, manual_close_reason = b.manual_close_reason
FROM public._bkp_shine_allineamento_sabrina_20260903 b
WHERE p.id = b.id;

COMMIT;
