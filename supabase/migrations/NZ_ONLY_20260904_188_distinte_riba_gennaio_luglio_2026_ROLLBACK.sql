-- ROLLBACK di NZ_ONLY_20260904_188_distinte_riba_gennaio_luglio_2026.sql
-- Riporta i 20 addebiti allo stato precedente leggendo da
-- public._bkp_effetti_bt_20260904, poi rimuove le 21 distinte e le loro 162
-- righe. Nessun dato inventato: le distinte del 31/08 (create il 03/09) restano.

BEGIN;

UPDATE public.bank_transactions bt
SET is_reconciled = b.is_reconciled,
    reconciled_at = b.reconciled_at,
    category      = b.category,
    note          = b.note
FROM public._bkp_effetti_bt_20260904 b
WHERE bt.id = b.id;

DELETE FROM public.riba_distinta_lines l
 USING public.riba_distinte d
 WHERE d.id = l.distinta_id
   AND d.note LIKE '%Caricata il 04/09/2026 dal PDF della banca%';

DELETE FROM public.riba_distinte
 WHERE note LIKE '%Caricata il 04/09/2026 dal PDF della banca%';

COMMIT;

-- --- Verifica ---------------------------------------------------------------
-- SELECT count(*) FROM public.riba_distinte;        -- atteso 7 (solo il 31/08)
-- SELECT count(*) FROM public.riba_distinta_lines;  -- atteso 36
-- SELECT count(*) FROM public.bank_transactions bt
--   JOIN public._bkp_effetti_bt_20260904 b ON b.id = bt.id
--   WHERE bt.is_reconciled <> b.is_reconciled;      -- atteso 0
