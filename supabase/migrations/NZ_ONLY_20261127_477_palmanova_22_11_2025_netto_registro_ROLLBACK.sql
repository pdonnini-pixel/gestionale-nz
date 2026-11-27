-- Rollback NZ_ONLY 477: rimette il netto di Palmanova del 22/11/2025 come prima (2448.02).
UPDATE public.daily_revenue d
SET net_revenue = 2448.02
FROM public.outlets o
WHERE o.id = d.outlet_id AND o.code = 'PLM' AND d.date = '2025-11-22'
  AND d.gross_revenue = 2986.58 AND d.net_revenue = 2448.01;
