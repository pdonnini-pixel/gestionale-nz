-- ZAGO_ONLY 425 — Negozio di Pietrasanta (chiuso a marzo 2025) e i suoi corrispettivi
-- Solo Zago (jxlwvzjreukscnswkbjx). Patrizio, 17/11/2026: «Pietrasanta era chiuso mi sembra da marzo 2025».
-- Il bilancio di verifica 2025 ha il conto 510110 «Corrispettivi Pietrasanta» = 50.905,19 (netto IVA);
-- su Drive ci sono i registri corrispettivi di gennaio, febbraio e marzo 2025, ultimo incasso il 10/03/2025.
-- La somma dei netti dei tre registri e' 50.905,19: torna al centesimo con il bilancio.
-- 1. Centro di costo e punto vendita, gia' chiusi (is_active = false, closing_date = ultimo incasso).
-- 2. Le 50 giornate in daily_revenue, come la 424.
-- Idempotente. Rollback: ZAGO_ONLY_20261117_425_..._ROLLBACK.sql
INSERT INTO public.cost_centers (company_id, code, role, color, label, is_active, sort_order)
SELECT c.id, 'zago_pietrasanta', 'outlet', 'bg-slate-600', 'Zago Pietrasanta', false, 4
FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.cost_centers x WHERE x.company_id = c.id AND x.code = 'zago_pietrasanta');

INSERT INTO public.outlets (company_id, code, name, outlet_type, city, province, region, cost_center_key,
                            is_active, bp_status, rent_free_days, closing_date, notes)
SELECT c.id, 'ZAGO-PIETRASANTA', 'Zago Pietrasanta', 'flagship', 'Pietrasanta', 'LU', 'Toscana', 'zago_pietrasanta',
       false, 'bozza', 0, '2025-03-10',
       'Negozio chiuso a marzo 2025 (Patrizio, 17/11/2026). Ultimo incasso nel registro corrispettivi: 10/03/2025.'
FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.outlets o WHERE o.company_id = c.id AND o.code = 'ZAGO-PIETRASANTA');

INSERT INTO public.daily_revenue (company_id, outlet_id, date, gross_revenue, net_revenue, source, notes)
SELECT o.company_id, o.id, v.d::date, v.g, v.n, 'manuale', 'Registro corrispettivi (import storico 2026-11-17)'
FROM (VALUES
('2025-01-02',782.40,641.31),
('2025-01-03',401.00,328.69),
('2025-01-04',3597.30,2948.61),
('2025-01-05',1373.60,1125.90),
('2025-01-06',1039.80,852.30),
('2025-01-08',270.80,221.97),
('2025-01-09',804.60,659.51),
('2025-01-10',950.50,779.10),
('2025-01-11',1218.70,998.93),
('2025-01-12',1223.20,1002.62),
('2025-01-15',190.00,155.74),
('2025-01-16',629.30,515.82),
('2025-01-17',50.00,40.98),
('2025-01-18',1360.90,1115.49),
('2025-01-19',926.20,759.18),
('2025-01-22',40.00,32.79),
('2025-01-24',1216.50,997.13),
('2025-01-25',1466.30,1201.89),
('2025-01-26',862.50,706.97),
('2025-01-29',1180.30,967.46),
('2025-01-30',388.10,318.11),
('2025-02-01',933.00,764.75),
('2025-02-02',1572.50,1288.93),
('2025-02-05',367.55,301.27),
('2025-02-06',827.20,678.03),
('2025-02-07',582.20,477.21),
('2025-02-08',1137.90,932.70),
('2025-02-09',1059.60,868.52),
('2025-02-12',362.60,297.21),
('2025-02-13',49.50,40.57),
('2025-02-14',798.50,654.51),
('2025-02-15',1934.70,1585.82),
('2025-02-16',1084.50,888.93),
('2025-02-19',315.30,258.44),
('2025-02-20',603.50,494.67),
('2025-02-21',879.90,721.23),
('2025-02-22',198.20,162.46),
('2025-02-23',1262.00,1034.43),
('2025-02-26',214.00,175.41),
('2025-02-27',1640.23,1344.45),
('2025-02-28',1589.50,1302.87),
('2025-03-01',5171.01,4238.53),
('2025-03-02',3834.30,3142.87),
('2025-03-04',1103.45,904.47),
('2025-03-05',498.70,408.77),
('2025-03-06',1112.50,911.89),
('2025-03-07',2799.80,2294.92),
('2025-03-08',5435.66,4455.46),
('2025-03-09',3415.35,2799.47),
('2025-03-10',1349.20,1105.90)
) AS v(d, g, n)
JOIN public.outlets o ON o.code = 'ZAGO-PIETRASANTA'
ON CONFLICT (company_id, outlet_id, date) DO NOTHING;
