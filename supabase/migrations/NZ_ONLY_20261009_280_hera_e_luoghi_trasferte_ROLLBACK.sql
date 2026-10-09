-- Rollback 280 (solo NZ): ripristino dei campi riempiti, senza cancellare righe.
UPDATE public.suppliers SET default_cost_category_id = NULL
WHERE vat_number IN ('05403151003','09247981005','02538160033','06291950969','03740360379','00823710116')
  AND default_cost_category_id = (SELECT id FROM public.cost_categories c WHERE c.company_id = suppliers.company_id AND c.code = 'VIAGGI');
-- I luoghi in outlet_travel_places e il PDR HERA in utility_supply_points si
-- disattivano togliendo la riga dalla tabella, previa conferma di Patrizio.
