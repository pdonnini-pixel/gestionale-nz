-- =============================================================================
-- NZ_ONLY — SHINE SRL: scadenze settembre/ottobre/novembre allineate agli elenchi di Sabrina
-- Applicato su NZ il 03/09/2026 via MCP. Dati NZ-specifici: non si replica su Made/Zago.
-- =============================================================================
--
-- GLI ELENCHI. Sabrina ha passato quattro blocchi: «quelle che tornano per
-- settembre» (prima rata delle 10 fatture di giugno, non presentata al 31/08,
-- piu' i terzi delle NC 106/107/108), le scadenze al 30/09 (seconda rata di
-- giugno + prima rata delle 4 fatture di luglio), al 31/10 (terza rata di giugno
-- + seconda di luglio + NC 151) e al 30/11 (terza rata di luglio).
-- Nel foglio la fattura 1194 compare due volte sia al 30/09 sia al 31/10: e' una
-- riga copiata, l'importo fattura (7.251,67) sono 3 rate, non 5. Non replicata.
--
-- COSA COINCIDEVA GIA'. Le 10 fatture di giugno (1103, 1107, 1142, 1187, 1194,
-- 1200, 1238, 1256, 1257, 1286): 3 rate, la prima gia' slittata al 30/09 con la
-- NZ_ONLY_169. Differenze di 1 centesimo sui terzi (1194, 1238, 1286, NC 107).
--
-- COSA CAMBIA
-- A) Fatture di luglio 1369 (6.129,28), 1381 (7.082,10), 1410 (1.412,76),
--    1418 (2.582,13): nel gestionale a rata unica alla data fattura (scadute),
--    per Sabrina 3 rate RiBa 60-90-120 f.m.: 30/09, 31/10, 30/11. La riga
--    esistente diventa rata 1/3, due righe nuove per rata 2 e 3. Importi a terzi
--    (arrotondamento sull'ultima), identici al foglio.
-- B) NC 106/107/108, terzo «rata 1»: era rimasto al 31/08 mentre la prima rata
--    delle fatture che stornano era slittata al 30/09. Slitta anche lui.
-- C) NC 151 (-89,06): al 31/10, dove la usa Sabrina.
-- D) NC 152 (-53,07, 26/08) e NC 314 (-17,89, pregresso 2025): in nessun elenco.
--    Regola di Patrizio: «se non c'e' tra quelle date l'ha gia' scalata». Chiuse.
--
-- 10 UPDATE + 8 INSERT. Backup in public._bkp_shine_allineamento_sabrina_20260903.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public._bkp_shine_allineamento_sabrina_20260903 AS
SELECT * FROM public.payables WHERE id IN (
 'c3e9f318-9923-4510-a0ea-340d187e3ae5','d3f40dc7-367f-4229-8be1-02fcaf784442','a5e8eedf-09a7-4023-b022-bffda0a8d08c','faf12a0f-716b-40d3-a76b-909801b2b21c',
 '34f5dbc1-9aa3-4cc8-97c8-de27d1a49864','eabeb1f4-9104-4467-a824-6803ebc5f75e','fe44d8a5-fea0-4db7-b915-2bc1251d4a97',
 'da0de720-1111-471b-9dda-1f30d96f788d','c2e754c1-7362-41b5-8b06-1f6bff8d41c4','99196987-d5fd-496d-96a2-5e6c1df1537c');

-- A) fatture di luglio: da rata unica a 3 rate
UPDATE public.payables p SET
  gross_amount = round(b.gross_amount/3, 2), net_amount = round(b.net_amount/3, 2), vat_amount = round(b.gross_amount/3, 2) - round(b.net_amount/3, 2),
  due_date = '2026-09-30', original_due_date = '2026-09-30', installment_number = 1, installment_total = 3, payment_method = 'riba_60',
  notes = coalesce(p.notes,'') || ' | Divisa in 3 rate RiBa 30/09, 31/10, 30/11 il 03/09/2026 (elenco scadenze SHINE di Sabrina)'
FROM public._bkp_shine_allineamento_sabrina_20260903 b
WHERE p.id = b.id AND b.invoice_number IN ('1369/26','1381/26','1410/26','1418/26');

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
  'Rata generata da ricalcolo piano RI.BA (03/09/2026, elenco scadenze SHINE di Sabrina)'
FROM public._bkp_shine_allineamento_sabrina_20260903 b
CROSS JOIN (VALUES (2, DATE '2026-10-31', 'riba_90'::payment_method), (3, DATE '2026-11-30', 'riba_120'::payment_method)) AS r(n, due, pm)
WHERE b.invoice_number IN ('1369/26','1381/26','1410/26','1418/26');

-- B) terzi «rata 1» delle NC 106/107/108 al 30/09
UPDATE public.payables SET due_date = '2026-09-30', postponed_to = '2026-09-30', postpone_count = coalesce(postpone_count,0) + 1,
  notes = coalesce(notes,'') || ' | Slitta al 30/09/2026 con la prima rata SHINE non presentata al 31/08 (elenco Sabrina 03/09/2026)'
WHERE id IN ('34f5dbc1-9aa3-4cc8-97c8-de27d1a49864','eabeb1f4-9104-4467-a824-6803ebc5f75e','fe44d8a5-fea0-4db7-b915-2bc1251d4a97') AND due_date = '2026-08-31';

-- C) NC 151 al 31/10
UPDATE public.payables SET due_date = '2026-10-31',
  notes = coalesce(notes,'') || ' | Scadenza al 31/10/2026 da elenco scadenze SHINE di Sabrina (03/09/2026)'
WHERE id = 'da0de720-1111-471b-9dda-1f30d96f788d' AND status = 'nota_credito';

-- D) NC 152 e NC 314 gia' scalate
UPDATE public.payables SET status = 'pagato', amount_paid = gross_amount, payment_date = '2026-08-31', closed_manually = true,
  manual_close_reason = 'NC non presente negli elenchi scadenze SHINE di Sabrina (settembre/ottobre/novembre, 03/09/2026): gia'' scalata. Data esatta non nota, usata la RiBa del 31/08. Regola confermata da Patrizio.',
  notes = coalesce(notes,'') || ' | Chiusa 03/09/2026: gia'' scalata (elenco Sabrina, regola Patrizio)'
WHERE id IN ('c2e754c1-7362-41b5-8b06-1f6bff8d41c4','99196987-d5fd-496d-96a2-5e6c1df1537c') AND status = 'nota_credito';

-- traccia
INSERT INTO public.payable_actions (payable_id, action_type, old_status, new_status, old_due_date, new_due_date, amount, note, operator_name)
SELECT p.id,
  CASE WHEN p.invoice_number IN ('1369/26','1381/26','1410/26','1418/26') THEN 'split_rate'
       WHEN p.invoice_number IN ('152/26','NC 314') THEN 'compensazione_nc' ELSE 'riallineamento_rate' END,
  b.status, p.status, b.due_date, p.due_date, p.gross_amount,
  'Allineamento SHINE agli elenchi scadenze di Sabrina (03/09/2026): ' || p.invoice_number || ' rata ' || coalesce(p.installment_number::text,'-') || '; backup in _bkp_shine_allineamento_sabrina_20260903', 'Claude Code'
FROM public.payables p LEFT JOIN public._bkp_shine_allineamento_sabrina_20260903 b ON b.id = p.id
WHERE p.supplier_name ILIKE 'SHINE%' AND NOT COALESCE(p.is_placeholder,false)
  AND (p.id IN (SELECT id FROM public._bkp_shine_allineamento_sabrina_20260903)
       OR (p.invoice_number IN ('1369/26','1381/26','1410/26','1418/26') AND p.installment_number IN (2,3)));

COMMIT;

-- VERIFICA
-- SELECT due_date, count(*), sum(amount_remaining) FROM public.payables
-- WHERE supplier_name ILIKE 'SHINE%' AND NOT COALESCE(is_placeholder,false)
--   AND status NOT IN ('pagato','annullato') AND amount_remaining <> 0
-- GROUP BY due_date ORDER BY due_date;
-- Atteso: 30/09 -> 30 righe 35.115,86 | 31/10 -> 18 righe 20.336,58 | 30/11 -> 4 righe 5.735,43 | nient'altro
-- (Sabrina, senza il doppione 1194: 35.115,81 | 20.336,56 | 5.735,43)
