-- =============================================================================
-- ROLLBACK NZ_ONLY 180 — rimette i 33 agganci com'erano prima del 04/09/2026
-- =============================================================================
-- Ripristina payables e bank_transactions dal backup integrale
-- public.backup_176_agganci_ante_fattura (to_jsonb della riga PRIMA della modifica).
-- Da usare solo se la bonifica si rivela sbagliata: riporta indietro anche gli
-- agganci impossibili, EPPI 32 compresa.
-- =============================================================================

BEGIN;

UPDATE public.payables p
SET bank_transaction_id = (b.payable_prima->>'bank_transaction_id')::uuid,
    amount_paid         = (b.payable_prima->>'amount_paid')::numeric,
    payment_date        = (b.payable_prima->>'payment_date')::date,
    closed_manually     = (b.payable_prima->>'closed_manually')::boolean,
    updated_at          = now()
FROM public.backup_176_agganci_ante_fattura b
WHERE p.id = (b.payable_prima->>'id')::uuid;

UPDATE public.bank_transactions bt
SET is_reconciled       = (b.movimento_prima->>'is_reconciled')::boolean,
    reconciled_at       = (b.movimento_prima->>'reconciled_at')::timestamptz,
    reconciled_invoice_id = (b.movimento_prima->>'reconciled_invoice_id')::uuid
FROM public.backup_176_agganci_ante_fattura b
WHERE bt.id = (b.movimento_prima->>'id')::uuid;

UPDATE public.reconciliation_log rl
SET status = 'applied'
FROM public.backup_176_agganci_ante_fattura b
WHERE rl.id = b.log_id AND rl.status = 'rejected';

-- I 6 riagganci ai movimenti reali vanno sciolti a parte: i movimenti coinvolti
-- non stanno nel backup (sono movimenti diversi da quelli sbagliati).
UPDATE public.bank_transactions
SET is_reconciled = false, reconciled_at = NULL, reconciled_invoice_id = NULL
WHERE id IN ('e28e3772-719e-4d12-b4d7-2732ab81f046','f5c64ae3-1149-41e0-8138-c51b5637c7f6',
             'f883e7de-0400-4441-a80a-a0f3cc4fca98','612a75ae-10b8-425c-bfd0-1c2fe8725f1d',
             '64fb8ed1-d779-4f65-b4db-8d099252ef2e','3ec82adb-5a71-482c-9f2a-971dde0649c1');

DELETE FROM public.reconciliation_log
WHERE notes LIKE 'ricerca movimento reale dopo migr. 176:%';

COMMIT;
