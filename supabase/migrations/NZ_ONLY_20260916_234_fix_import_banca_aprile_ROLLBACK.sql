-- ROLLBACK di NZ_ONLY_20260916_234_fix_import_banca_aprile.sql
--
-- Rimette le 22 righe duplicate dal backup e toglie i due versamenti inseriti a mano.
-- Nota: il travaso di categoria/nota sul gemello che resta non viene annullato, perche' e'
-- additivo (riempie solo campi vuoti) e non toglie nulla a nessuno.

BEGIN;

INSERT INTO public.bank_transactions
SELECT * FROM public.bank_transactions_bkp_20260916_dupes b
WHERE NOT EXISTS (SELECT 1 FROM public.bank_transactions t WHERE t.id = b.id);

DELETE FROM public.bank_transactions
 WHERE source = 'estratto_conto'
   AND transaction_date = DATE '2026-04-29'
   AND amount IN (1995.00, 2875.25);

COMMIT;
