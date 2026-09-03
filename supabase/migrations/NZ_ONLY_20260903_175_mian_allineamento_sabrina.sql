-- =============================================================================
-- NZ_ONLY — MIAN SRL: scadenze settembre/ottobre/novembre allineate agli elenchi di Sabrina
-- Applicato su NZ il 03/09/2026 via MCP. Dati NZ-specifici: non si replica su Made/Zago.
-- =============================================================================
--
-- GLI ELENCHI. Tre blocchi: 30/09 (ultima rata delle fatture di maggio 662, 680,
-- 691, 697; seconda rata di giugno 746, 760, 792 e dei terzi delle NC 114, 115,
-- 120; prima rata delle fatture di luglio), 31/10 (terza rata di giugno + seconda
-- di luglio + NC 151), 30/11 (terza rata di luglio).
--
-- COSA COINCIDEVA GIA'. Tutte le rate di maggio e giugno, con i terzi delle NC.
-- (Le etichette «1/2/3 scadenza» del foglio non seguono il numero di rata del
-- gestionale per 691 e 697, ma la rata aperta e l'importo sono gli stessi.)
--
-- COSA CAMBIA
-- A) Fatture di luglio 839 (8.829,75), 847 (4.656,74), 865 (3.806,40),
--    883 (3.339,75): nel gestionale a rata unica alla data fattura (scadute),
--    per Sabrina 3 rate RiBa 60-90-120 f.m.: 30/09, 31/10, 30/11. La riga
--    esistente diventa rata 1/3, due righe nuove per rata 2 e 3.
--    (847: il foglio mette il centesimo di arrotondamento sulla prima rata,
--    il gestionale sull'ultima. Totale identico.)
-- B) NC 151 (-519,72): al 31/10, dove la usa Sabrina.
-- C) NC 51 rata 1 (-14,23, marzo) e NC 56 rata 2 (-406,26, aprile): in nessun
--    elenco. Regola di Patrizio: «se non c'e' tra quelle date l'ha gia' scalata».
--    Chiuse.
--
-- NON TOCCATE: fatture 948 (24/08, 15.329,30 in 3 rate 31/10-30/11-31/12) e
-- 979 (27/08, 35.225,67 in 3 rate 31/10-30/11-31/12), generate dal piano
-- fornitore. Non compaiono negli elenchi di Sabrina di ottobre e novembre:
-- probabilmente gli elenchi sono stati fatti prima di riceverle. Da chiederle.
--
-- 7 UPDATE + 8 INSERT. Backup in public._bkp_mian_allineamento_sabrina_20260903.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public._bkp_mian_allineamento_sabrina_20260903 AS
SELECT * FROM public.payables WHERE id IN (
 'a79ab5ba-2b5c-4708-a715-194686dd18a2','c7db0a34-8796-4bf9-9fd3-dfcbe7532dfb','97a329b4-49fd-478b-9749-a4e2a1469c25','8cc91e2a-325d-4927-b408-34e1774dfb89',
 'ece838ba-56ae-40af-8526-f1f78a3569c4','898fb595-519f-460e-b49b-d92a5745f865','91d9bf64-1a87-4b97-8128-5821f4799a23');

-- A) fatture di luglio: da rata unica a 3 rate
UPDATE public.payables p SET
  gross_amount = round(b.gross_amount/3, 2), net_amount = round(b.net_amount/3, 2), vat_amount = round(b.gross_amount/3, 2) - round(b.net_amount/3, 2),
  due_date = '2026-09-30', original_due_date = '2026-09-30', installment_number = 1, installment_total = 3, payment_method = 'riba_60',
  notes = coalesce(p.notes,'') || ' | Divisa in 3 rate RiBa 30/09, 31/10, 30/11 il 03/09/2026 (elenco scadenze MIAN di Sabrina)'
FROM public._bkp_mian_allineamento_sabrina_20260903 b
WHERE p.id = b.id AND b.invoice_number IN ('839','847','865','883');

INSERT INTO public.payables (company_id, supplier_id, supplier_name, supplier_vat, invoice_number, invoice_date, due_date, original_due_date,
  gross_amount, net_amount, vat_amount, withholding_amount, amount_paid, status, payment_method, installment_number, installment_total,
  electronic_invoice_id, cost_category_id, outlet_id, payment_bank_account_id, iban, is_placeholder, notes)
SELECT b.company_id, b.supplier_id, b.supplier_name, b.supplier_vat, b.invoice_number, b.invoice_date, r.due, r.due,
  CASE WHEN r.n = 2 THEN round(b.gross_amount/3, 2) ELSE b.gross_amount - 2*round(b.gross_amount/3, 2) END,
  CASE WHEN r.n = 2 THEN round(b.net_amount/3, 2)   ELSE b.net_amount   - 2*round(b.net_amount/3, 2)   END,
  (CASE WHEN r.n = 2 THEN round(b.gross_amount/3, 2) ELSE b.gross_amount - 2*round(b.gross_amount/3, 2) END)
  - (CASE WHEN r.n = 2 THEN round(b.net_amount/3, 2) ELSE b.net_amount - 2*round(b.net_amount/3, 2) END),
  0, 0, 'da_pagare', r.pm, r.n, 3,
  b.electronic_invoice_id, b.cost_category_id, b.outlet_id, b.payment_bank_account_id, b.iban, false,
  'Rata generata da ricalcolo piano RI.BA (03/09/2026, elenco scadenze MIAN di Sabrina)'
FROM public._bkp_mian_allineamento_sabrina_20260903 b
CROSS JOIN (VALUES (2, DATE '2026-10-31', 'riba_90'::payment_method), (3, DATE '2026-11-30', 'riba_120'::payment_method)) AS r(n, due, pm)
WHERE b.invoice_number IN ('839','847','865','883');

-- B) NC 151 al 31/10
UPDATE public.payables SET due_date = '2026-10-31',
  notes = coalesce(notes,'') || ' | Scadenza al 31/10/2026 da elenco scadenze MIAN di Sabrina (03/09/2026)'
WHERE id = 'ece838ba-56ae-40af-8526-f1f78a3569c4' AND status = 'nota_credito';

-- C) NC 51/1 e NC 56/2 gia' scalate
UPDATE public.payables SET status = 'pagato', amount_paid = gross_amount, payment_date = '2026-08-31', closed_manually = true,
  manual_close_reason = 'NC non presente negli elenchi scadenze MIAN di Sabrina (settembre/ottobre/novembre, 03/09/2026): gia'' scalata. Data esatta non nota, usata la RiBa del 31/08. Regola confermata da Patrizio.',
  notes = coalesce(notes,'') || ' | Chiusa 03/09/2026: gia'' scalata (elenco Sabrina, regola Patrizio)'
WHERE id IN ('898fb595-519f-460e-b49b-d92a5745f865','91d9bf64-1a87-4b97-8128-5821f4799a23') AND status = 'nota_credito';

-- traccia
INSERT INTO public.payable_actions (payable_id, action_type, old_status, new_status, old_due_date, new_due_date, amount, note, operator_name)
SELECT p.id,
  CASE WHEN p.invoice_number IN ('839','847','865','883') THEN 'split_rate'
       WHEN p.invoice_number IN ('51','56') THEN 'compensazione_nc' ELSE 'riallineamento_rate' END,
  b.status, p.status, b.due_date, p.due_date, p.gross_amount,
  'Allineamento MIAN agli elenchi scadenze di Sabrina (03/09/2026): ' || p.invoice_number || ' rata ' || coalesce(p.installment_number::text,'-') || '; backup in _bkp_mian_allineamento_sabrina_20260903', 'Claude Code'
FROM public.payables p LEFT JOIN public._bkp_mian_allineamento_sabrina_20260903 b ON b.id = p.id
WHERE p.supplier_name ILIKE 'MIAN%' AND NOT COALESCE(p.is_placeholder,false)
  AND (p.id IN (SELECT id FROM public._bkp_mian_allineamento_sabrina_20260903)
       OR (p.invoice_number IN ('839','847','865','883') AND p.installment_number IN (2,3)));

COMMIT;

-- VERIFICA
-- SELECT due_date, count(*), sum(amount_remaining) FROM public.payables
-- WHERE supplier_name ILIKE 'MIAN%' AND NOT COALESCE(is_placeholder,false)
--   AND status NOT IN ('pagato','annullato') AND amount_remaining <> 0
-- GROUP BY due_date ORDER BY due_date;
-- Atteso (senza 948/979): 30/09 37.055,47 | 31/10 15.449,29 | 30/11 6.877,54
-- (Sabrina: 37.055,46 | 15.449,26 | 6.877,55)
