-- ROLLBACK di NZ_ONLY_20260903_172_gruppofb_allineamento_sabrina.sql
-- Ripristina le 9 righe dal backup (stato, importi, date, chiusura manuale, note). Nessuna cancellazione di dati vivi.
BEGIN;

UPDATE public.payables p SET
  status = b.status, amount_paid = b.amount_paid, payment_date = b.payment_date,
  closed_manually = b.closed_manually, manual_close_reason = b.manual_close_reason,
  due_date = b.due_date, notes = b.notes
FROM public._bkp_gruppofb_allineamento_sabrina_20260903 b
WHERE p.id = b.id;

DELETE FROM public.payable_actions
WHERE note LIKE 'Allineamento GRUPPO FB all''elenco partite aperte di Sabrina del 03/09/2026%'
  AND payable_id IN (SELECT id FROM public._bkp_gruppofb_allineamento_sabrina_20260903);

COMMIT;
