-- ROLLBACK di NZ_ONLY_20260904_190_distinte_riba_ottobre_dicembre_2025.sql

BEGIN;

UPDATE public.bank_transactions bt
SET is_reconciled = b.is_reconciled, reconciled_at = b.reconciled_at,
    category = b.category, note = b.note
FROM public._bkp_effetti_bt_2025_20260904 b
WHERE bt.id = b.id;

DELETE FROM public.riba_distinta_lines l
 USING public.riba_distinte d
 WHERE d.id = l.distinta_id
   AND d.note LIKE '%NEW ZAGO 2025%';

DELETE FROM public.riba_distinte WHERE note LIKE '%NEW ZAGO 2025%';

COMMIT;

-- --- Verifica ---------------------------------------------------------------
-- SELECT count(*) FROM public.riba_distinte;        -- atteso 28
-- SELECT count(*) FROM public.riba_distinta_lines;  -- atteso 198
