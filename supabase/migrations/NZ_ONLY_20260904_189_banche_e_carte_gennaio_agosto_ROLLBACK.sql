-- ROLLBACK di NZ_ONLY_20260904_189_banche_e_carte_gennaio_agosto.sql

BEGIN;

-- 3) Riapre le commissioni AMEX chiuse per natura
UPDATE public.bank_transactions bt
SET is_reconciled = b.is_reconciled, reconciled_at = b.reconciled_at,
    category = b.category, note = b.note
FROM public._bkp_amex_commissioni_20260904 b
WHERE bt.id = b.id;

-- 2) Rimette i dieci movimenti Intesa rimossi
INSERT INTO public.bank_transactions
SELECT (b.*)::public.bank_transactions FROM public._bkp_intesa_doppioni_20260904 b
WHERE NOT EXISTS (SELECT 1 FROM public.bank_transactions t WHERE t.id = b.id);

-- 1) Toglie i sei movimenti Mugello inseriti a mano
DELETE FROM public.bank_transactions
 WHERE source = 'manual'
   AND transaction_date BETWEEN date '2026-05-06' AND date '2026-05-20'
   AND note LIKE '%Buco di sincronizzazione A-Cube%';

COMMIT;

-- --- Verifica ---------------------------------------------------------------
-- SELECT round(sum(amount),2) FROM public.bank_transactions bt
--   JOIN public.bank_accounts ba ON ba.id = bt.bank_account_id
--   WHERE ba.iban = 'IT55L0306905465100000012417';   -- atteso 13.300,58 (col doppione)
