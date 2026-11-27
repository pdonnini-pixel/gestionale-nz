-- NZ_ONLY 480 — Consuntivo ricavi 2025 di New Zago diviso per i mesi veri del registro corrispettivi
-- Solo New Zago (xfvfxsvqpnpvibgeqpqp). Patrizio, 26/11/2026 («procedi con tutti e due»).
-- Prima: budget_entries 2025, conti Corrispettivi dei 6 negozi, actual_amount = totale annuo / 12
-- in ogni mese (anche nei mesi prima dell'apertura: Valmontone apre a ottobre 2025).
-- Dopo: actual_amount = imponibile del mese dal registro corrispettivi (zip del 26/11/2026),
-- zero nei mesi in cui il negozio non era aperto.
-- Il TOTALE ANNUO per negozio NON cambia (quadratura con il bilancio 2025): la differenza di
-- arrotondamento fra registro e totale annuo già scritto (pochi centesimi) va su dicembre.
--   barberino: registro 354565.42, anno nel gestionale 354565.44, differenza +0.02 su dicembre
--   brugnato: registro 195260.64, anno nel gestionale 195260.64, differenza +0.00 su dicembre
--   franciacorta: registro 410564.09, anno nel gestionale 410564.04, differenza -0.05 su dicembre
--   palmanova: registro 281267.18, anno nel gestionale 281267.16, differenza -0.02 su dicembre
--   valdichiana: registro 814815.74, anno nel gestionale 814815.72, differenza -0.02 su dicembre
--   valmontone: registro 219073.99, anno nel gestionale 219074.04, differenza +0.05 su dicembre
-- Cambia solo actual_amount (e note, updated_at). Il preventivo (budget_amount) resta com'era.
-- Le righe 'all' (altri ricavi) non si toccano.
-- Copia dei valori prima della modifica: tutte le 72 righe avevano actual_amount = budget_amount
-- = valore mensile qui sotto, note NULL; il rollback le rimette così.
-- Rollback: NZ_ONLY_20261126_480_consuntivo_2025_mesi_veri_ROLLBACK.sql
BEGIN;
UPDATE public.budget_entries be
SET actual_amount = v.a,
    note = 'Consuntivo dal registro corrispettivi 2025 (prima: totale annuo / 12), 26/11/2026',
    updated_at = now()
FROM (VALUES
('barberino','510108',1,0.00),
('barberino','510108',2,0.00),
('barberino','510108',3,12349.79),
('barberino','510108',4,35573.64),
('barberino','510108',5,28298.05),
('barberino','510108',6,30018.26),
('barberino','510108',7,47940.81),
('barberino','510108',8,34040.87),
('barberino','510108',9,31620.81),
('barberino','510108',10,41950.23),
('barberino','510108',11,54213.90),
('barberino','510108',12,38559.08),
('brugnato','510114',1,0.00),
('brugnato','510114',2,0.00),
('brugnato','510114',3,0.00),
('brugnato','510114',4,0.00),
('brugnato','510114',5,0.00),
('brugnato','510114',6,2731.00),
('brugnato','510114',7,39243.14),
('brugnato','510114',8,33682.58),
('brugnato','510114',9,25282.92),
('brugnato','510114',10,28771.50),
('brugnato','510114',11,36773.70),
('brugnato','510114',12,28775.80),
('franciacorta','510110',1,0.00),
('franciacorta','510110',2,0.00),
('franciacorta','510110',3,0.00),
('franciacorta','510110',4,26170.89),
('franciacorta','510110',5,44019.25),
('franciacorta','510110',6,35350.55),
('franciacorta','510110',7,59428.52),
('franciacorta','510110',8,49625.08),
('franciacorta','510110',9,39788.85),
('franciacorta','510110',10,49949.58),
('franciacorta','510110',11,56330.93),
('franciacorta','510110',12,49900.39),
('palmanova','510112',1,0.00),
('palmanova','510112',2,0.00),
('palmanova','510112',3,0.00),
('palmanova','510112',4,20820.43),
('palmanova','510112',5,24980.52),
('palmanova','510112',6,26545.15),
('palmanova','510112',7,39548.59),
('palmanova','510112',8,41426.90),
('palmanova','510112',9,26952.22),
('palmanova','510112',10,30642.59),
('palmanova','510112',11,37962.05),
('palmanova','510112',12,32388.71),
('valdichiana','510107',1,85256.31),
('valdichiana','510107',2,49350.11),
('valdichiana','510107',3,50076.05),
('valdichiana','510107',4,65496.31),
('valdichiana','510107',5,57595.62),
('valdichiana','510107',6,55407.73),
('valdichiana','510107',7,77224.11),
('valdichiana','510107',8,69726.40),
('valdichiana','510107',9,52840.07),
('valdichiana','510107',10,68953.89),
('valdichiana','510107',11,91769.59),
('valdichiana','510107',12,91119.53),
('valmontone','510122',1,0.00),
('valmontone','510122',2,0.00),
('valmontone','510122',3,0.00),
('valmontone','510122',4,0.00),
('valmontone','510122',5,0.00),
('valmontone','510122',6,0.00),
('valmontone','510122',7,0.00),
('valmontone','510122',8,0.00),
('valmontone','510122',9,0.00),
('valmontone','510122',10,47293.16),
('valmontone','510122',11,85533.14),
('valmontone','510122',12,86247.74)
) AS v(cc, acc, m, a)
WHERE be.year = 2025 AND be.cost_center = v.cc AND be.account_code = v.acc AND be.month = v.m;
COMMIT;
