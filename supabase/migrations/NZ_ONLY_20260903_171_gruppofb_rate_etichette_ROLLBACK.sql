-- ROLLBACK di NZ_ONLY_20260903_171_gruppofb_rate_etichette.sql
-- Ripristina numero rata, date e note delle 8 righe dal backup. Nessuna cancellazione.
BEGIN;

UPDATE public.payables SET installment_number = 99
WHERE id IN (SELECT id FROM public._bkp_gruppofb_rate_etichette_20260903 WHERE installment_number = 2);

UPDATE public.payables p SET installment_number = b.installment_number, original_due_date = b.original_due_date, due_date = b.due_date, notes = b.notes
FROM public._bkp_gruppofb_rate_etichette_20260903 b
WHERE p.id = b.id AND b.installment_number = 3;

UPDATE public.payables p SET installment_number = b.installment_number, original_due_date = b.original_due_date, due_date = b.due_date, notes = b.notes
FROM public._bkp_gruppofb_rate_etichette_20260903 b
WHERE p.id = b.id AND b.installment_number = 2;

DELETE FROM public.payable_actions
WHERE action_type = 'riallineamento_rate'
  AND note LIKE 'Scambio etichette rate GRUPPO FB %'
  AND payable_id IN (SELECT id FROM public._bkp_gruppofb_rate_etichette_20260903);

COMMIT;
