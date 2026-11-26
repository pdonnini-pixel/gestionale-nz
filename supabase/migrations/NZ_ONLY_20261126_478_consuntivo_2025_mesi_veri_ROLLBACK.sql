-- ROLLBACK NZ_ONLY 478 — rimette il consuntivo 2025 dei 6 negozi a totale annuo / 12 come prima.
-- Solo New Zago.
BEGIN;
UPDATE public.budget_entries be
SET actual_amount = v.flat, note = NULL, updated_at = now()
FROM (VALUES
('barberino','510108',29547.12),
('brugnato','510114',16271.72),
('franciacorta','510110',34213.67),
('palmanova','510112',23438.93),
('valdichiana','510107',67901.31),
('valmontone','510122',18256.17)
) AS v(cc, acc, flat)
WHERE be.year = 2025 AND be.cost_center = v.cc AND be.account_code = v.acc;
COMMIT;
