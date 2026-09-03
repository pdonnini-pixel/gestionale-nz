-- ROLLBACK di NZ_ONLY_20260903_170_carte_bcc_luglio_2026.sql
-- Ripristina stato di riconciliazione, categoria e note degli 8 movimenti
-- leggendo da public._bkp_carte_luglio_20260903. Nessun dato inventato.

BEGIN;

UPDATE public.bank_transactions bt
SET is_reconciled = b.is_reconciled,
    reconciled_at = b.reconciled_at,
    category      = b.category,
    note          = b.note
FROM public._bkp_carte_luglio_20260903 b
WHERE bt.id = b.id;

COMMIT;

-- --- Verifica ---------------------------------------------------------------
-- SELECT count(*) FROM public.bank_transactions bt
--   JOIN public._bkp_carte_luglio_20260903 b ON b.id = bt.id
--   WHERE coalesce(bt.note,'') <> coalesce(b.note,'')
--      OR coalesce(bt.category,'') <> coalesce(b.category,'')
--      OR bt.is_reconciled <> b.is_reconciled;   -- atteso 0
