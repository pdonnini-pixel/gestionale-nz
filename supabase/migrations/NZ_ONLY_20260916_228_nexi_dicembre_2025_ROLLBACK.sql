-- =====================================================================
-- ROLLBACK NZ_ONLY 228 — toglie le sei righe Nexi di dicembre 2025.
-- L'Amex di dicembre 2025 (migration 227) non si tocca.
-- =====================================================================

DELETE FROM public.acquirer_fees f
 USING public.acquirer_contracts c
 WHERE c.id = f.contract_id
   AND c.acquirer = 'nexi'
   AND f.period_year = 2025
   AND f.period_month = 12;
