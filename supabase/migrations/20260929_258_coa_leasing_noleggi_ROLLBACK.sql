-- Rollback di 20260929_258: disattiva (non cancella) le 3 voci e ripristina l'ordine.
-- Se sulle voci ci sono gia' righe di budget, lasciarle attive e valutare con Patrizio.
BEGIN;
UPDATE public.chart_of_accounts SET is_active = false, updated_at = now()
 WHERE code IN ('650105', '650111', '650112');
UPDATE public.chart_of_accounts SET sort_order = 513, updated_at = now()
 WHERE code = '650113' AND sort_order = 516;
UPDATE public.chart_of_accounts SET sort_order = 514, updated_at = now()
 WHERE code = '650120' AND sort_order = 517;
COMMIT;
