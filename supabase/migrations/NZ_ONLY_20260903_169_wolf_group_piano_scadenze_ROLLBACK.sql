-- =============================================================================
-- ROLLBACK di NZ_ONLY_20260903_169_wolf_group_piano_scadenze.sql
-- Riporta le tre scadenze WOLF GROUP com'erano prima dell'allineamento al piano
-- fornitore, leggendo dal backup public._bkp_wolf_piano_20260903.
-- =============================================================================

BEGIN;

-- 1) Via le rate nate dalla migration: sono le righe WOLF GROUP che NON stanno
--    nel backup (quindi non esistevano prima) e che non hanno mai visto un
--    pagamento ne' un movimento bancario. Guardia doppia: se nel frattempo una
--    di queste rate e' stata pagata o riconciliata, NON viene cancellata.
DELETE FROM public.payables p
USING public.suppliers s
WHERE s.id = p.supplier_id
  AND s.partita_iva = '06847270482'
  AND p.invoice_number IN ('285', '357')
  AND NOT EXISTS (SELECT 1 FROM public._bkp_wolf_piano_20260903 b WHERE b.id = p.id)
  AND COALESCE(p.amount_paid, 0) = 0
  AND p.bank_transaction_id IS NULL
  AND p.cash_movement_id IS NULL;

-- 2) Le righe preesistenti tornano ai valori del backup (date, importi, rate, note).
--    amount_paid e i riferimenti bancari non sono mai stati toccati dalla migration:
--    qui si ripristinano comunque dal backup per coerenza.
UPDATE public.payables p
SET due_date           = b.due_date,
    original_due_date  = b.original_due_date,
    gross_amount       = b.gross_amount,
    installment_number = b.installment_number,
    installment_total  = b.installment_total,
    notes              = b.notes
FROM public._bkp_wolf_piano_20260903 b
WHERE b.id = p.id;

COMMIT;

-- Il backup NON viene cancellato: resta consultabile.
-- Per eliminarlo, solo dopo verifica esplicita:
--   DROP TABLE public._bkp_wolf_piano_20260903;
