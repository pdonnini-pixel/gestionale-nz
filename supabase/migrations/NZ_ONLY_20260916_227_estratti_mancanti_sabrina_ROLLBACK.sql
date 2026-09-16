-- =====================================================================
-- ROLLBACK NZ_ONLY 227
-- Toglie SOLO le 27 righe nate dai documenti arrivati il 16/09/2026 e
-- rimette a «banca» le tre di Valdichiana ricavate dall'addebito SDD.
-- Le righe gia' presenti prima (PLM gennaio, BRG/FRC/VLM febbraio) non
-- erano state toccate dalla migration e non si toccano qui.
-- =====================================================================

WITH nate (merchant_code, period_year, period_month) AS (
  VALUES
    ('7373035260', 2025, 12),
    ('7377153036', 2025, 12),
    ('7377511100', 2025, 12),
    ('7378034250', 2025, 12),
    ('7379416167', 2025, 12),
    ('7379605249', 2025, 12),
    ('7543377782', 2025, 12),
    ('7543394233', 2025, 12),
    ('LN0005458723', 2026, 1),
    ('LN0005489545', 2026, 1),
    ('LN0005533489', 2026, 1),
    ('LN0005674696', 2026, 1),
    ('LN0005458723', 2026, 2),
    ('LN0005475974', 2026, 2),
    ('LN0005458723', 2026, 3),
    ('LN0005475974', 2026, 3),
    ('LN0005489545', 2026, 3),
    ('LN0005533489', 2026, 3),
    ('LN0005674696', 2026, 3),
    ('LN0005755045', 2026, 3),
    ('LN0004777495', 2026, 8),
    ('LN0005458723', 2026, 8),
    ('LN0005475974', 2026, 8),
    ('LN0005489545', 2026, 8),
    ('LN0005533489', 2026, 8),
    ('LN0005674696', 2026, 8),
    ('LN0005755045', 2026, 8)
)
DELETE FROM public.acquirer_fees f
 USING public.acquirer_contracts c, nate n
 WHERE c.id = f.contract_id
   AND c.merchant_code = n.merchant_code
   AND f.period_year = n.period_year
   AND f.period_month = n.period_month;

UPDATE public.acquirer_fees f
   SET source = 'banca', gross_amount = NULL,
       note = 'da addebito SDD, documento da richiedere', updated_at = now()
  FROM public.acquirer_contracts c
 WHERE c.id = f.contract_id
   AND c.merchant_code = 'LN0004777495'
   AND f.period_year = 2026 AND f.period_month IN (1, 2, 3);
