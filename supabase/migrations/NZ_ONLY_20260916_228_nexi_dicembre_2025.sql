-- =====================================================================
-- NZ_ONLY 228 — Nexi dicembre 2025: l'ultimo documento che mancava
-- ---------------------------------------------------------------------
-- Sabrina ha mandato i sei estratti Nexi di dicembre 2025 (Torino non era
-- ancora aperto). Con questi non resta piu' un solo euro di commissioni
-- senza documento dietro, da dicembre 2025 ad agosto 2026.
--
-- Quadratura, fatta prima di scrivere:
--   * per i cinque contratti al netto la somma delle commissioni lette
--     coincide al centesimo con la differenza fra negoziato e accrediti;
--   * per Valdichiana (al lordo) negoziato = accrediti, come da contratto;
--   * l'addebito atteso in banca a gennaio (651,06 di commissioni al lordo
--     + 15,00 di acquiring + 12,00 di bollo) fa **678,06**, esattamente lo
--     scarto che restava inspiegato sugli addebiti di gennaio 2026.
--     Quel buco era questo.
--
-- Nessun contratto nuovo, nessun UUID scritto a mano, nessuna riga
-- esistente sovrascritta. Solo NZ.
-- =====================================================================

WITH v (merchant_code, period_year, period_month, gross_amount, fee_amount, fixed_amount, stamp_amount, settlement_mode) AS (
  VALUES
    ('LN0004777495', 2025, 12, 86223.08, 651.06, 2.50, 2.00, 'lordo'),
    ('LN0005458723', 2025, 12, 34603.09, 274.63, 2.50, 2.00, 'netto'),
    ('LN0005475974', 2025, 12, 31074.66, 240.74, 2.50, 2.00, 'netto'),
    ('LN0005489545', 2025, 12, 35896.32, 253.70, 2.50, 2.00, 'netto'),
    ('LN0005533489', 2025, 12, 14837.60, 108.99, 2.50, 2.00, 'netto'),
    ('LN0005674696', 2025, 12, 69160.46, 520.06, 2.50, 2.00, 'netto')
)
INSERT INTO public.acquirer_fees
  (company_id, contract_id, outlet_id, period_year, period_month,
   gross_amount, fee_amount, fixed_amount, stamp_amount, settlement_mode, source, note)
SELECT c.company_id, c.id, c.outlet_id, v.period_year, v.period_month,
       v.gross_amount, v.fee_amount, v.fixed_amount, v.stamp_amount, v.settlement_mode,
       'documento', 'estratto conto Nexi dicembre 2025'
  FROM v
  JOIN public.acquirer_contracts c
    ON c.merchant_code = v.merchant_code AND c.acquirer = 'nexi'
ON CONFLICT (contract_id, period_year, period_month) DO NOTHING;

-- Verifica:
--   SELECT period_year, period_month, count(*), round(sum(fee_amount),2)
--     FROM acquirer_fees WHERE period_year = 2025 GROUP BY 1,2;
--   Atteso: 2025-12, 14 righe (6 Nexi + 8 Amex), 2.109,20 di commissioni.
