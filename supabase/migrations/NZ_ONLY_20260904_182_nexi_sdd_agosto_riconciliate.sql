-- =============================================================================
-- NZ_ONLY 182 — NEXI: le 7 fatture del 13/07 chiuse dagli SDD del 12/08
-- =============================================================================
-- Coda della bonifica 180. Là le 7 commissioni NEXI da 25,62 erano rimaste da
-- pagare perché la ricerca del movimento reale agganciava solo gli abbinamenti
-- univoci nei due sensi, e sette fatture identiche contro sette addebiti
-- identici non lo sono mai.
--
-- Ricerca allargata a tutto l'estratto conto (04/09/2026): il 12/08/2026 la banca
-- ha addebitato SETTE SDD da 25,62 a favore di NEXI PAYMENTS SPA
-- (n. 649276963, 649276964, 649276965, 649276966, 649276967, 649276968, 649276969),
-- tutti liberi. Le fatture NEXI aperte da 25,62 erano sette, tutte del 13/07/2026
-- (3214540 … 3214546). Sette contro sette, stesso importo, stesso beneficiario,
-- un mese dopo l'emissione: il blocco torna al centesimo, e quale addebito paghi
-- quale fattura è indifferente perché sono identici.
--
-- Abbinamento uno a uno: fatture ordinate per numero, addebiti per descrizione
-- (che contiene il numero SDD progressivo). Totale 179,34 €.
--
-- Le altre tre scadenze rimaste scoperte dalla 180 non hanno trovato nessun
-- movimento nemmeno con la ricerca allargata (importo entro il 5% o 5 €, senza
-- vincolo di nome, numero fattura cercato in causale su tutto lo storico):
--   UNICOOP 0073002604   400,00   scadenza 03/07/2026
--   REMAS 4513/00         36,60   scadenza 31/08/2026
--   PALMANOVA B02026001204 23,99  scadenza 24/07/2026
-- Restano da pagare, insieme a EPPI 32 (3.050,00), che non risulta pagata da
-- nessuna uscita successiva alla sua emissione.
-- =============================================================================

BEGIN;

WITH f AS (
  SELECT id AS payable_id, row_number() OVER (ORDER BY invoice_number) AS rn
  FROM public.payables
  WHERE supplier_name ILIKE '%NEXI%' AND bank_transaction_id IS NULL
    AND status <> 'pagato' AND gross_amount = 25.62
), m AS (
  SELECT bt.id AS bt_id, bt.transaction_date, row_number() OVER (ORDER BY bt.description) AS rn
  FROM public.bank_transactions bt
  WHERE bt.transaction_date = '2026-08-12' AND bt.amount = -25.62
    AND COALESCE(bt.is_reconciled, false) = false
    AND bt.description ILIKE '%NEXI PAYMENTS%'
    AND NOT EXISTS (SELECT 1 FROM public.payables q WHERE q.bank_transaction_id = bt.id)
), pair AS (
  SELECT f.payable_id, m.bt_id, m.transaction_date FROM f JOIN m ON m.rn = f.rn
)
UPDATE public.payables p
SET bank_transaction_id = pair.bt_id,
    amount_paid = p.gross_amount,
    payment_date = pair.transaction_date,
    closed_manually = false,
    updated_at = now()
FROM pair WHERE p.id = pair.payable_id;

UPDATE public.bank_transactions bt
SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = p.id
FROM public.payables p
WHERE p.bank_transaction_id = bt.id
  AND bt.transaction_date = '2026-08-12' AND bt.amount = -25.62;

COMMIT;

-- VERIFICA: le 7 fatture 3214540..3214546 risultano pagate il 12/08/2026.
