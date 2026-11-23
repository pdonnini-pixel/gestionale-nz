-- =====================================================================
-- ROLLBACK NZ_ONLY 445 — rimette l'aggancio UNICOOP / Global Blue
-- =====================================================================
-- Attenzione a cosa si sta facendo: questo rimette un collegamento che Patrizio
-- il 19/11/2026 ha detto essere sbagliato. Serve solo se la 445 si è rivelata
-- un errore mio, non per «tornare come prima».
-- =====================================================================

BEGIN;

-- 1. La coppia esce dall'elenco delle escluse
SELECT public.riammetti_coppia(
  '8d643100-2790-43c1-abd4-a395f314b2d9',
  'f7b49085-a305-4239-bb97-2e1b0cef62e5'
);

-- 2. Il movimento torna agganciato
UPDATE public.payables
   SET bank_transaction_id = '8d643100-2790-43c1-abd4-a395f314b2d9',
       cash_movement_id = '8d643100-2790-43c1-abd4-a395f314b2d9',
       updated_at = now()
 WHERE id = 'f7b49085-a305-4239-bb97-2e1b0cef62e5'
   AND bank_transaction_id IS NULL;

UPDATE public.bank_transactions
   SET is_reconciled = true,
       reconciled_at = now(),
       reconciled_invoice_id = 'f7b49085-a305-4239-bb97-2e1b0cef62e5'
 WHERE id = '8d643100-2790-43c1-abd4-a395f314b2d9'
   AND reconciled_invoice_id IS NULL;

-- 3. La riga di log del 20/11 torna applied, senza la nota del 23/11
UPDATE public.reconciliation_log
   SET status = 'applied',
       notes = regexp_replace(COALESCE(notes, ''), ' \| 23/11/2026: rifatto dal motore.*$', '')
 WHERE payable_id = 'f7b49085-a305-4239-bb97-2e1b0cef62e5'
   AND bank_transaction_id = '8d643100-2790-43c1-abd4-a395f314b2d9'
   AND status = 'rejected'
   AND notes LIKE '%23/11/2026: rifatto dal motore%';

COMMIT;
