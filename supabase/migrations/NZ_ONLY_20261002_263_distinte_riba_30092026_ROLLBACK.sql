-- ROLLBACK di NZ_ONLY_20261002_263_distinte_riba_30092026.sql
-- Ripristina lo stato precedente leggendo da public._bkp_riba_effetti_30092026
-- (righe payables complete com'erano prima) e public._bkp_riba_bt_30092026.

BEGIN;

-- 1. Scadenzario com'era
UPDATE public.payables p
SET amount_paid             = b.amount_paid,
    status                  = b.status,
    payment_date            = b.payment_date,
    payment_method          = b.payment_method,
    payment_bank_account_id = b.payment_bank_account_id,
    bank_transaction_id     = b.bank_transaction_id,
    is_provisional_paid     = b.is_provisional_paid,
    provisional_paid_at     = b.provisional_paid_at,
    closed_manually         = b.closed_manually,
    notes                   = b.notes,
    updated_at              = now()
FROM public._bkp_riba_effetti_30092026 b
WHERE p.id = b.id;

-- 2. Legami NC creati dall'intervento
DELETE FROM public.payable_credit_note_links
WHERE origin = 'distinta'
  AND credit_note_payable_id IN (SELECT id FROM public._bkp_riba_effetti_30092026)
  AND applied_at::date = DATE '2026-10-02';

-- 3. Log di riconciliazione creato dall'intervento
DELETE FROM public.reconciliation_log
WHERE match_type = 'manual'
  AND notes LIKE 'Distinta MPS % effetti scad. 30/09/2026%'
  AND bank_transaction_id IN (SELECT id FROM public._bkp_riba_bt_30092026);

-- 4. I 4 addebiti tornano com'erano
UPDATE public.bank_transactions t
SET is_reconciled = b.is_reconciled, reconciled_at = b.reconciled_at, note = b.note
FROM public._bkp_riba_bt_30092026 b
WHERE t.id = b.id;

-- 5. Distinte caricate
DELETE FROM public.riba_distinta_lines
WHERE distinta_id IN (SELECT id FROM public.riba_distinte WHERE file_name LIKE 'Distinta MPS 1378% SCAD.%30/09/2026');
DELETE FROM public.riba_distinte WHERE file_name LIKE 'Distinta MPS 1378% SCAD.%30/09/2026';

-- Le payable_actions restano come storico (aggiungere una riga di annullamento se serve).
COMMIT;
