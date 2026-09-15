-- Rollback del seed 222: toglie solo le righe inserite dal seed.
DELETE FROM public.acquirer_fees
 WHERE period_year = 2026
   AND note IN ('estratto Nexi', 'da addebito SDD, documento da richiedere')
    OR note LIKE 'estratto Amex %';
DELETE FROM public.acquirer_contracts WHERE acquirer IN ('amex', 'nexi');
