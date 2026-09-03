-- ROLLBACK di NZ_ONLY_20260903_168_distinte_riba_31082026.sql
-- Ripristina esattamente lo stato precedente leggendo da public._bkp_riba_effetti_31082026,
-- che contiene le 85 righe payables complete com'erano prima dell'intervento.
-- Nessun dato inventato: ogni campo torna al valore di backup.

BEGIN;

-- 1. Scadenzario com'era (importi, stato, date, aggancio al movimento, note)
UPDATE public.payables p
SET amount_paid             = b.amount_paid,
    amount_remaining        = b.amount_remaining,
    status                  = b.status,
    due_date                = b.due_date,
    payment_date            = b.payment_date,
    payment_method          = b.payment_method,
    payment_bank_account_id = b.payment_bank_account_id,
    bank_transaction_id     = b.bank_transaction_id,
    is_provisional_paid     = b.is_provisional_paid,
    provisional_paid_at     = b.provisional_paid_at,
    closed_manually         = b.closed_manually,
    notes                   = b.notes,
    updated_at              = now()
FROM public._bkp_riba_effetti_31082026 b
WHERE p.id = b.id;

-- 2. Log di riconciliazione creato dall'intervento
DELETE FROM public.reconciliation_log
WHERE match_type = 'manual'
  AND notes LIKE 'Distinta MPS effetti scad. 31/08/2026%'
  AND bank_transaction_id IN (
    '3f8d45d4-b7fb-4388-b80b-05a597ac0185',
    '2c869e80-2e99-411d-b719-5d86e5354571',
    'b9225953-4a38-4481-a1b1-10020fb48d16',
    'a0b98f14-5484-4f5f-badb-4a5e8b5469fa');

-- 3. I 4 addebiti «EFFETTI RITIRATI» tornano da riconciliare
UPDATE public.bank_transactions
SET is_reconciled = false, reconciled_at = NULL, note = NULL
WHERE id IN (
  '3f8d45d4-b7fb-4388-b80b-05a597ac0185',
  '2c869e80-2e99-411d-b719-5d86e5354571',
  'b9225953-4a38-4481-a1b1-10020fb48d16',
  'a0b98f14-5484-4f5f-badb-4a5e8b5469fa');

-- 4. Carico documentale delle distinte (le righe cadono in cascata sul distinta_id)
DELETE FROM public.riba_distinta_lines
WHERE distinta_id IN (SELECT id FROM public.riba_distinte WHERE file_name LIKE 'Distinta MPS 1369%');
DELETE FROM public.riba_distinte WHERE file_name LIKE 'Distinta MPS 1369%';

COMMIT;

-- --- Verifica ---------------------------------------------------------------
-- SELECT count(*) FROM public.payables
--   WHERE bank_transaction_id IN ('3f8d45d4-b7fb-4388-b80b-05a597ac0185',
--     '2c869e80-2e99-411d-b719-5d86e5354571','b9225953-4a38-4481-a1b1-10020fb48d16',
--     'a0b98f14-5484-4f5f-badb-4a5e8b5469fa');            -- atteso 0
-- SELECT count(*) FROM public.riba_distinte;               -- atteso 0
