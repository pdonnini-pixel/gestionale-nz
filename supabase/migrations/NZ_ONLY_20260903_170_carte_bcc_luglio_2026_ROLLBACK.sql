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

-- PARTE 2 — riapre le 17 fatture pagate con carta chiuse per riscontro
BEGIN;

UPDATE public.payables p
SET amount_paid             = b.amount_paid,
    amount_remaining        = b.amount_remaining,
    status                  = b.status,
    payment_date            = b.payment_date,
    payment_bank_account_id = b.payment_bank_account_id,
    bank_transaction_id     = b.bank_transaction_id,
    closed_manually         = b.closed_manually,
    is_provisional_paid     = b.is_provisional_paid,
    provisional_paid_at     = b.provisional_paid_at,
    notes                   = b.notes,
    updated_at              = now()
FROM public._bkp_carte_payables_20260903 b
WHERE p.id = b.id;

COMMIT;

-- SELECT count(*), round(sum(gross_amount),2) FROM public.payables
--   WHERE payment_method::text ILIKE '%cart%' AND status IN ('da_pagare','in_scadenza','scaduto');
-- atteso dopo il rollback: 25 righe, 2.157,30
