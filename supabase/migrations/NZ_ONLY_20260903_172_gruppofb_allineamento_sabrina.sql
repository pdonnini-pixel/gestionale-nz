-- =============================================================================
-- NZ_ONLY — GRUPPO FB: allineamento all'elenco partite aperte di Sabrina (03/09/2026)
-- Applicato su NZ il 03/09/2026 via MCP. Dati NZ-specifici: non si replica su Made/Zago.
-- =============================================================================
--
-- L'ELENCO. Sabrina ha passato le partite aperte GRUPPO FB: per ogni fattura la
-- prossima rata (al 30/09) con l'importo della singola rata; per le NC la quota
-- corrispondente. Totale netto al 30/09: 26.386,67 EUR.
-- Il confronto con lo scadenzario quadrava su tutte le righe (differenze di 1
-- centesimo sui terzi arrotondati: 3992, 3896, 4340; la NC 4604 e' intera nel
-- gestionale, -107,36, e a terzi nel foglio, -35,78) tranne tre cose:
--
-- A) Fatture 2548, 2704, 3315, 3480: la rata 1 (RiBa originale 30/06, spostata
--    al 31/08 a luglio) risultava ancora APERTA, 21.610,68 EUR in tutto. Per
--    Sabrina queste 4 fatture sono saldate (non compaiono nell'elenco), e la
--    causale della distinta del 31/08 diceva gia' «SALDO FATT». Chiuse come
--    pagate il 30/06, chiusura manuale, senza aggancio bancario: in banca il
--    30/06 ci sono 3 addebiti EFFETTI RITIRATI (104.422,15 EUR, 29 effetti)
--    ancora tutti da riconciliare, serve la distinta MPS per agganciarli.
-- B) NC 3438 e 3439 (a terzi, come la fattura 3480 che stornano): il terzo
--    «rata 2» era ancora aperto (-2.354,60 EUR). Gli altri due terzi erano gia'
--    stati compensati con le RiBa del 31/07 e del 31/08; questo va con la RiBa
--    del 30/06 della rata 1 di 3480. Non e' nell'elenco di Sabrina. Chiuso come
--    compensato, stesso schema delle righe gemelle.
-- C) Fattura 3657: le due_date delle 3 rate erano scalate (rata 1 pagata il
--    31/07 con scadenza 30/09, rata 3 aperta con scadenza 31/08). Riportate
--    alle scadenze originali 31/07 / 31/08 / 30/09: Sabrina ha la rata 3 al 30/09.
--
-- NON toccate: NC 1116 (-114,68, marzo), NC 4731 (-473,97) e NC 4767 (-2.143,85):
-- aperte nel gestionale, assenti nell'elenco. Sono crediti nostri: restano aperte
-- finche' Sabrina non dice con quale RiBa le usa.
--
-- Solo UPDATE su 9 righe di payables. Backup completo in
-- public._bkp_gruppofb_allineamento_sabrina_20260903. Traccia in payable_actions.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public._bkp_gruppofb_allineamento_sabrina_20260903 AS
SELECT * FROM public.payables
WHERE supplier_name ILIKE 'GRUPPO F%B%' AND NOT COALESCE(is_placeholder,false)
  AND ( (invoice_number IN ('2548','2704','3315','3480') AND installment_number = 1)
     OR (invoice_number IN ('3438','3439') AND installment_number = 2)
     OR invoice_number = '3657' );

-- A) rate 1 di 2548/2704/3315/3480: chiuse (RiBa 30/06)
UPDATE public.payables SET
  status = 'pagato', amount_paid = gross_amount, payment_date = '2026-06-30',
  closed_manually = true, manual_close_reason = 'Elenco partite aperte GRUPPO FB di Sabrina (03/09/2026): fattura saldata. RiBa 30/06 (movimenti EFFETTI RITIRATI 30/06 da riconciliare con distinta)',
  notes = coalesce(notes,'') || ' | Chiusa 03/09/2026 da elenco Sabrina: RiBa del 30/06, non piu'' tra le partite aperte'
WHERE supplier_name ILIKE 'GRUPPO F%B%' AND NOT COALESCE(is_placeholder,false)
  AND invoice_number IN ('2548','2704','3315','3480') AND installment_number = 1 AND status = 'da_pagare';

-- B) terzo residuo delle NC 3438/3439: compensato con la rata 1 di 3480
UPDATE public.payables SET
  status = 'pagato', amount_paid = gross_amount, payment_date = '2026-06-30',
  closed_manually = true, manual_close_reason = 'Compensata con la rata 1 di 3480 (RiBa 30/06). Non tra le partite aperte GRUPPO FB di Sabrina del 03/09/2026',
  notes = coalesce(notes,'') || ' | Compensata via RiBa 30/06 (elenco Sabrina 03/09/2026)'
WHERE supplier_name ILIKE 'GRUPPO F%B%' AND NOT COALESCE(is_placeholder,false)
  AND invoice_number IN ('3438','3439') AND installment_number = 2 AND status = 'nota_credito';

-- C) 3657: scadenze riportate a quelle originali
UPDATE public.payables SET due_date = original_due_date,
  notes = coalesce(notes,'') || ' | Scadenza rata riallineata 03/09/2026 (elenco Sabrina: rata 3 al 30/09)'
WHERE supplier_name ILIKE 'GRUPPO F%B%' AND NOT COALESCE(is_placeholder,false)
  AND invoice_number = '3657' AND due_date <> original_due_date;

-- traccia
INSERT INTO public.payable_actions (payable_id, action_type, old_status, new_status, old_due_date, new_due_date, amount, note, operator_name)
SELECT b.id,
  CASE WHEN b.invoice_number = '3657' THEN 'riallineamento_rate' WHEN b.invoice_number IN ('3438','3439') THEN 'compensazione_nc' ELSE 'chiusura_pagata_sabrina' END,
  b.status, p.status, b.due_date, p.due_date, p.gross_amount,
  'Allineamento GRUPPO FB all''elenco partite aperte di Sabrina del 03/09/2026 (fattura ' || p.invoice_number || ' rata ' || coalesce(p.installment_number::text,'-') || '); backup in _bkp_gruppofb_allineamento_sabrina_20260903',
  'Claude Code'
FROM public._bkp_gruppofb_allineamento_sabrina_20260903 b JOIN public.payables p ON p.id = b.id
WHERE b.status IS DISTINCT FROM p.status OR b.due_date IS DISTINCT FROM p.due_date;

COMMIT;

-- VERIFICA
-- SELECT due_date, count(*), sum(amount_remaining) FROM public.payables
-- WHERE supplier_name ILIKE 'GRUPPO F%B%' AND NOT COALESCE(is_placeholder,false)
--   AND status NOT IN ('pagato','annullato') AND amount_remaining <> 0
-- GROUP BY due_date ORDER BY due_date;
-- Atteso: nessuna riga con scadenza <= 31/08 (a parte le NC 1116/4731/4767 e la NC 4572);
-- al 30/09 le stesse 23 partite dell'elenco di Sabrina.
