-- ROLLBACK di NZ_ONLY_20260916_235_fix_import_pos_palmanova_30_aprile.sql
BEGIN;
DELETE FROM public.bank_transactions
 WHERE source = 'estratto_conto'
   AND transaction_date = DATE '2026-05-04'
   AND amount = 79.33
   AND description LIKE '%00007%';
COMMIT;
