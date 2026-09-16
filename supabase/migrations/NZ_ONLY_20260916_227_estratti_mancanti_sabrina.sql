-- =====================================================================
-- NZ_ONLY 227 — I documenti mancanti arrivati da Sabrina (16/09/2026)
-- ---------------------------------------------------------------------
-- Gli estratti che nelle note risultavano «scansioni senza testo» sono
-- arrivati nativi: 22 estratti Nexi (gennaio, febbraio, marzo e agosto 2026)
-- e l'estratto Amex di dicembre 2025. Tutti letti riga per riga, non stimati.
--
-- Controlli fatti prima di scrivere:
--   * Nexi al netto: la somma delle commissioni lette coincide al centesimo
--     con la differenza fra negoziato e accrediti, su 18 documenti su 18
--     (unica eccezione TRN marzo, un centesimo di arrotondamento).
--   * Nexi al lordo (Valdichiana): negoziato = accrediti, come da contratto.
--   * Amex: i totali per punto vendita parsati coincidono con i «TOTALE
--     PUNTO VENDITA EURO» del documento su tutti e 8 i codici AX, e la somma
--     con il «TOTALE EURO 6.690,43 -60,25».
--   * Le tre righe di Valdichiana ricavate dall'addebito SDD (gennaio 695,79,
--     febbraio 432,04, marzo 294,59) sono confermate identiche dal documento:
--     qui passano da source 'banca' a 'documento' e prendono il transato.
--
-- Nessun contratto nuovo: i codici AX e i punti vendita LN esistono gia'.
-- Nessun valore sovrascritto: le righe gia' lette da un documento restano
-- come sono (ON CONFLICT DO UPDATE solo dove source = 'banca').
-- Nessun UUID scritto a mano: il contratto si risolve per merchant_code.
-- Solo NZ.
-- =====================================================================

WITH v (merchant_code, acquirer, period_year, period_month, gross_amount, fee_amount, fixed_amount, stamp_amount, settlement_mode, note) AS (
  VALUES
    ('7373035260', 'amex', 2025, 12, 1207.88, 10.87, 0.00, 0.00, 'lordo', 'estratto conto Amex n. 25FX7OU di dicembre 2025'),
    ('7377153036', 'amex', 2025, 12, 945.00, 8.51, 0.00, 0.00, 'lordo', 'estratto conto Amex n. 25FX7OU di dicembre 2025'),
    ('7377511100', 'amex', 2025, 12, 882.00, 7.95, 0.00, 0.00, 'lordo', 'estratto conto Amex n. 25FX7OU di dicembre 2025'),
    ('7378034250', 'amex', 2025, 12, 329.65, 2.97, 0.00, 0.00, 'lordo', 'estratto conto Amex n. 25FX7OU di dicembre 2025'),
    ('7379416167', 'amex', 2025, 12, 731.73, 6.59, 0.00, 0.00, 'lordo', 'estratto conto Amex n. 25FX7OU di dicembre 2025'),
    ('7379605249', 'amex', 2025, 12, 688.76, 6.20, 0.00, 0.00, 'lordo', 'estratto conto Amex n. 25FX7OU di dicembre 2025'),
    ('7543377782', 'amex', 2025, 12, 84.80, 0.76, 0.00, 0.00, 'lordo', 'estratto conto Amex n. 25FX7OU di dicembre 2025'),
    ('7543394233', 'amex', 2025, 12, 1820.61, 16.40, 0.00, 0.00, 'lordo', 'estratto conto Amex n. 25FX7OU di dicembre 2025'),
    ('LN0004777495', 'nexi', 2026, 1, 94715.74, 695.79, 2.50, 2.00, 'lordo', 'estratto conto Nexi gennaio 2026'),
    ('LN0005458723', 'nexi', 2026, 1, 48828.20, 360.93, 2.50, 2.00, 'netto', 'estratto conto Nexi gennaio 2026'),
    ('LN0005489545', 'nexi', 2026, 1, 71165.30, 539.28, 2.50, 2.00, 'netto', 'estratto conto Nexi gennaio 2026'),
    ('LN0005533489', 'nexi', 2026, 1, 21525.55, 159.02, 2.50, 2.00, 'netto', 'estratto conto Nexi gennaio 2026'),
    ('LN0005674696', 'nexi', 2026, 1, 49943.37, 369.94, 2.50, 2.00, 'netto', 'estratto conto Nexi gennaio 2026'),
    ('LN0004777495', 'nexi', 2026, 2, 59485.26, 432.04, 2.50, 2.00, 'lordo', 'estratto conto Nexi febbraio 2026'),
    ('LN0005458723', 'nexi', 2026, 2, 28277.99, 224.14, 2.50, 2.00, 'netto', 'estratto conto Nexi febbraio 2026'),
    ('LN0005475974', 'nexi', 2026, 2, 24750.89, 208.77, 2.50, 2.00, 'netto', 'estratto conto Nexi febbraio 2026'),
    ('LN0004777495', 'nexi', 2026, 3, 40150.30, 294.59, 2.50, 2.00, 'lordo', 'estratto conto Nexi marzo 2026'),
    ('LN0005458723', 'nexi', 2026, 3, 17289.11, 129.64, 2.50, 2.00, 'netto', 'estratto conto Nexi marzo 2026'),
    ('LN0005475974', 'nexi', 2026, 3, 18658.52, 154.58, 2.50, 2.00, 'netto', 'estratto conto Nexi marzo 2026'),
    ('LN0005489545', 'nexi', 2026, 3, 33491.95, 246.94, 2.50, 2.00, 'netto', 'estratto conto Nexi marzo 2026'),
    ('LN0005533489', 'nexi', 2026, 3, 8749.68, 66.09, 2.50, 0.00, 'netto', 'estratto conto Nexi marzo 2026'),
    ('LN0005674696', 'nexi', 2026, 3, 13921.54, 104.63, 2.50, 2.00, 'netto', 'estratto conto Nexi marzo 2026'),
    ('LN0005755045', 'nexi', 2026, 3, 11366.92, 80.85, 10.00, 2.00, 'netto', 'estratto conto Nexi marzo 2026'),
    ('LN0004777495', 'nexi', 2026, 8, 62812.10, 471.89, 2.50, 2.00, 'lordo', 'estratto conto Nexi agosto 2026'),
    ('LN0005458723', 'nexi', 2026, 8, 40658.04, 315.20, 2.50, 2.00, 'netto', 'estratto conto Nexi agosto 2026'),
    ('LN0005475974', 'nexi', 2026, 8, 42647.43, 375.10, 2.50, 2.00, 'netto', 'estratto conto Nexi agosto 2026'),
    ('LN0005489545', 'nexi', 2026, 8, 48796.24, 374.06, 2.50, 2.00, 'netto', 'estratto conto Nexi agosto 2026'),
    ('LN0005533489', 'nexi', 2026, 8, 36116.00, 281.84, 2.50, 2.00, 'netto', 'estratto conto Nexi agosto 2026'),
    ('LN0005674696', 'nexi', 2026, 8, 31181.35, 237.76, 2.50, 2.00, 'netto', 'estratto conto Nexi agosto 2026'),
    ('LN0005755045', 'nexi', 2026, 8, 39248.73, 301.21, 2.50, 2.00, 'netto', 'estratto conto Nexi agosto 2026')
)
INSERT INTO public.acquirer_fees
  (company_id, contract_id, outlet_id, period_year, period_month,
   gross_amount, fee_amount, fixed_amount, stamp_amount, settlement_mode, source, note)
SELECT c.company_id, c.id, c.outlet_id, v.period_year, v.period_month,
       v.gross_amount, v.fee_amount, v.fixed_amount, v.stamp_amount, v.settlement_mode, 'documento', v.note
  FROM v
  JOIN public.acquirer_contracts c
    ON c.merchant_code = v.merchant_code AND c.acquirer = v.acquirer
ON CONFLICT (contract_id, period_year, period_month) DO UPDATE
   SET gross_amount = EXCLUDED.gross_amount,
       fee_amount   = EXCLUDED.fee_amount,
       fixed_amount = EXCLUDED.fixed_amount,
       stamp_amount = EXCLUDED.stamp_amount,
       source       = 'documento',
       note         = EXCLUDED.note,
       updated_at   = now()
 WHERE public.acquirer_fees.source = 'banca';

-- Verifica:
--   SELECT period_year, period_month, count(*), round(sum(fee_amount),2)
--     FROM acquirer_fees GROUP BY 1,2 ORDER BY 1,2;
