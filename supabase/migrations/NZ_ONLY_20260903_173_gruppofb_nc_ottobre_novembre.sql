-- =============================================================================
-- NZ_ONLY — GRUPPO FB: scadenze di ottobre e novembre allineate all'elenco di Sabrina
-- Applicato su NZ il 03/09/2026 via MCP. Dati NZ-specifici: non si replica su Made/Zago.
-- =============================================================================
--
-- L'ELENCO. Sabrina ha passato le scadenze GRUPPO FB al 31/10 (15 righe, netto
-- 11.603,80 EUR) e al 30/11 (6 righe, netto 6.787,27 EUR). Le rate delle fatture
-- coincidono con lo scadenzario (12 righe al 31/10, 5 al 30/11; le solite
-- differenze di 1 centesimo sui terzi di 4307, 4336 e 4340). Tre note di credito
-- stavano in date diverse:
--
-- A) NC 4731 (-473,97) e NC 4767 (-2.143,85): nel gestionale alla data del
--    documento (30/07 e 07/08), Sabrina le usa con la RiBa del 31/10.
--    Spostate al 31/10. (Nel foglio la seconda e' scritta «NC4731 -2.143,85»:
--    e' la 4767, la 4731 vale 473,97.)
-- B) NC 4604 (-107,36): nel gestionale intera al 10/07, Sabrina la spalma a
--    terzi come la fattura 4605 che storna (-35,78 al 30/09, -35,79 al 31/10,
--    -35,79 al 30/11). Fatto lo stesso schema gia' usato per le NC 4307/4336:
--    la riga esistente diventa rata 1/3, due righe nuove per rata 2 e 3.
--
-- C) NC 4572 (-1.171,20, «unica scadenza»): nel gestionale all'8/07, Sabrina la
--    conta nelle partite di settembre. Spostata al 30/09.
--
-- D) NC 1116 (-114,68, marzo, parcheggiata al 31/12): non compare in nessuno
--    dei tre elenchi. Patrizio: «se non c'e' tra quelle date l'ha gia' scalata».
--    Chiusa come compensata (data non nota, usata la RiBa del 31/08).
--
-- 5 UPDATE + 2 INSERT. Backup in public._bkp_gruppofb_nc_ottobre_20260903.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public._bkp_gruppofb_nc_ottobre_20260903 AS
SELECT * FROM public.payables WHERE supplier_name ILIKE 'GRUPPO F%B%' AND NOT COALESCE(is_placeholder,false) AND invoice_number IN ('4604','4731','4767');

-- A) NC 4731 e 4767 al 31/10
UPDATE public.payables SET due_date = '2026-10-31',
  notes = coalesce(notes,'') || ' | Scadenza al 31/10/2026 da elenco scadenze ottobre di Sabrina (03/09/2026)'
WHERE supplier_name ILIKE 'GRUPPO F%B%' AND NOT COALESCE(is_placeholder,false) AND invoice_number IN ('4731','4767') AND status = 'nota_credito';

-- B) NC 4604 a terzi
UPDATE public.payables SET gross_amount = -35.78, net_amount = -29.34, vat_amount = -6.44,
  due_date = '2026-09-30', original_due_date = '2026-09-30', installment_total = 3, payment_method = 'riba_60',
  notes = coalesce(notes,'') || ' | NC spalmata a terzi 03/09/2026 (elenco Sabrina): -35,78 al 30/09, -35,79 al 31/10, -35,79 al 30/11'
WHERE id = '99ddf6a1-04d4-49d4-89d9-dd4535f31ef4' AND gross_amount = -107.36;

INSERT INTO public.payables (company_id, supplier_id, supplier_name, supplier_vat, invoice_number, invoice_date, due_date, original_due_date,
  gross_amount, net_amount, vat_amount, withholding_amount, amount_paid, status, payment_method, payment_method_code, installment_number, installment_total,
  electronic_invoice_id, cost_category_id, outlet_id, is_placeholder, notes)
SELECT b.company_id, b.supplier_id, b.supplier_name, b.supplier_vat, b.invoice_number, b.invoice_date, r.due, r.due,
  -35.79, -29.33, -6.46, 0, 0, 'nota_credito', r.pm, NULL, r.n, 3,
  b.electronic_invoice_id, b.cost_category_id, b.outlet_id, false,
  'Rata generata da ricalcolo piano RI.BA (03/09/2026, elenco Sabrina): terzo della NC 4604'
FROM public._bkp_gruppofb_nc_ottobre_20260903 b
CROSS JOIN (VALUES (2, DATE '2026-10-31', 'riba_90'::payment_method), (3, DATE '2026-11-30', 'riba_120'::payment_method)) AS r(n, due, pm)
WHERE b.id = '99ddf6a1-04d4-49d4-89d9-dd4535f31ef4';

-- C) NC 4572 al 30/09
INSERT INTO public._bkp_gruppofb_nc_ottobre_20260903
SELECT * FROM public.payables WHERE supplier_name ILIKE 'GRUPPO F%B%' AND NOT COALESCE(is_placeholder,false) AND invoice_number = '4572' AND status = 'nota_credito';
UPDATE public.payables SET due_date = '2026-09-30',
  notes = coalesce(notes,'') || ' | Scadenza al 30/09/2026 da elenco partite aperte di Sabrina (03/09/2026)'
WHERE supplier_name ILIKE 'GRUPPO F%B%' AND NOT COALESCE(is_placeholder,false) AND invoice_number = '4572' AND status = 'nota_credito';

-- D) NC 1116 gia' scalata
INSERT INTO public._bkp_gruppofb_nc_ottobre_20260903
SELECT * FROM public.payables WHERE id = '5854d607-3c79-42dd-881d-b386f5ff0b36' AND status = 'nota_credito';
UPDATE public.payables SET status = 'pagato', amount_paid = gross_amount, payment_date = '2026-08-31',
  closed_manually = true,
  manual_close_reason = 'NC gia'' scalata da Sabrina in una RiBa precedente al 03/09/2026 (non tra le partite aperte GRUPPO FB di settembre/ottobre/novembre). Data esatta non nota, usata la RiBa del 31/08. Confermato da Patrizio.',
  notes = coalesce(notes,'') || ' | Chiusa 03/09/2026: gia'' scalata (elenco Sabrina, conferma Patrizio)'
WHERE id = '5854d607-3c79-42dd-881d-b386f5ff0b36' AND status = 'nota_credito';

-- traccia
INSERT INTO public.payable_actions (payable_id, action_type, old_status, new_status, old_due_date, new_due_date, amount, note, operator_name)
SELECT p.id, CASE WHEN p.invoice_number = '4604' THEN 'split_nc' ELSE 'riallineamento_rate' END, b.status, p.status, b.due_date, p.due_date, p.gross_amount,
  'Allineamento GRUPPO FB alle scadenze ottobre/novembre di Sabrina (03/09/2026): NC ' || p.invoice_number || ' rata ' || coalesce(p.installment_number::text,'-') || '; backup in _bkp_gruppofb_nc_ottobre_20260903', 'Claude Code'
FROM public.payables p LEFT JOIN public._bkp_gruppofb_nc_ottobre_20260903 b ON b.id = p.id
WHERE p.supplier_name ILIKE 'GRUPPO F%B%' AND NOT COALESCE(p.is_placeholder,false) AND p.invoice_number IN ('4604','4731','4767','4572','1116');

COMMIT;

-- VERIFICA
-- SELECT due_date, count(*), sum(amount_remaining) FROM public.payables
-- WHERE supplier_name ILIKE 'GRUPPO F%B%' AND NOT COALESCE(is_placeholder,false)
--   AND status NOT IN ('pagato','annullato') AND amount_remaining <> 0
-- GROUP BY due_date ORDER BY due_date;
-- Atteso: 30/09 -> 23 righe 26.386,70 | 31/10 -> 15 righe 11.603,81 | 30/11 -> 6 righe 6.787,27 | nient'altro
