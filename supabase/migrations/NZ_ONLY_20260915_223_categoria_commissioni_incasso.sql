-- =====================================================================
-- NZ_ONLY 223 — Una sola categoria per gli addebiti degli acquirer
-- ---------------------------------------------------------------------
-- Gli addebiti di Nexi e American Express nel 2026 erano sparsi fra quattro
-- destinazioni diverse: 82 righe gia' su 'commissioni_incasso', 36 senza
-- categoria, 36 su 'utenze' (fra cui le commissioni Nexi di Valdichiana,
-- 1.589,92 euro finiti in bolletta) e 2 su 'fees'.
--
-- Qui le 74 righe fuori posto passano a 'commissioni_incasso'. Sono tutte
-- e sole le richieste di addebito dei due acquirer: commissioni sul
-- transato, commissione di acquiring, bollo e canoni. Nessuna e' un'utenza.
--
-- Backup delle categorie precedenti, riga per riga:
--   docs/backup/20260915_bank_transactions_categoria_commissioni_PRIMA.csv
-- Rollback puntuale per id nel file _ROLLBACK a fianco.
--
-- Nessuna cancellazione, nessun importo toccato: cambia solo `category`.
-- Solo NZ (Made e Zago non hanno movimenti di acquiring).
-- =====================================================================

UPDATE public.bank_transactions
   SET category = 'commissioni_incasso'
 WHERE amount < 0
   AND transaction_date >= DATE '2026-01-01'
   AND (description ILIKE '%NEXI PAYMENTS%' OR description ILIKE '%AMERICAN EXPRESS%')
   AND COALESCE(category, '') <> 'commissioni_incasso';

-- Verifica: nessuna riga di acquiring deve restare fuori categoria.
--   SELECT COALESCE(category,'(nessuna)'), count(*), sum(amount)
--     FROM bank_transactions
--    WHERE amount < 0 AND transaction_date >= '2026-01-01'
--      AND (description ILIKE '%NEXI PAYMENTS%' OR description ILIKE '%AMERICAN EXPRESS%')
--    GROUP BY 1;
-- Atteso: una sola riga, 'commissioni_incasso', 156 movimenti, -6.010,74.
