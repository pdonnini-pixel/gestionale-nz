-- ROLLBACK di NZ_ONLY_20260905_191_uscite_2025_chiuse_per_natura.sql
-- Riapre le 528 uscite del 2025 leggendo da public._bkp_uscite_2025_20260905.

BEGIN;

UPDATE public.bank_transactions bt
SET is_reconciled = b.is_reconciled,
    reconciled_at = b.reconciled_at,
    category      = b.category,
    note          = b.note
FROM public._bkp_uscite_2025_20260905 b
WHERE bt.id = b.id;

COMMIT;

-- --- Verifica ---------------------------------------------------------------
-- SELECT count(*) FROM public.bank_transactions
--   WHERE NOT is_reconciled AND amount < 0 AND transaction_date < date '2026-01-01';
-- atteso dopo il rollback: 528
