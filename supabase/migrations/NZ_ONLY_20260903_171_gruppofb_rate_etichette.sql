-- =============================================================================
-- NZ_ONLY — GRUPPO FB, fatture 2548 / 2704 / 3315 / 3480 (3 rate RiBa ciascuna):
--           scambio delle ETICHETTE tra rata 2 e rata 3. I pagamenti non si toccano.
-- Applicato su NZ il 03/09/2026 via MCP. Dati NZ-specifici: non si replica su Made/Zago.
-- =============================================================================
--
-- SITUAZIONE PRIMA. Per ognuna delle 4 fatture:
--   rata 1  scad. orig. 30/06, spostata al 31/08 (foglio Sabrina, luglio)   APERTA
--   rata 2  scad. 31/07   pagata il 31/08 dalla distinta RiBa MPS 136948817 (con movimento)
--   rata 3  scad. 31/08   pagata il 31/07 (chiusura da foglio Sabrina, senza movimento)
-- Etichette incrociate: la RiBa del 31/08 aveva chiuso la rata «31/07» e il
-- pagamento del 31/07 aveva chiuso la rata «31/08». I soldi tornavano (2 rate
-- pagate, 1 aperta per fattura; somme dei 2 addebiti al centesimo), solo le
-- date delle rate erano scambiate. Richiesta di Patrizio: sistemare SOLO le etichette.
--
-- COSA CAMBIA (8 righe di payables, solo UPDATE):
--   le righe pagate il 31/07 senza movimento  -> installment_number 2, scadenza 31/07
--   le righe pagate dalla RiBa del 31/08      -> installment_number 3, scadenza 31/08
-- Tutto il resto resta sulla riga (status, payment_date, bank_transaction_id,
-- cash_movement_id, note, righe di distinta e reconciliation_log che la citano).
-- Passaggio in tre tempi (2 -> 99, 3 -> 2, 99 -> 3) per non urtare l'indice
-- univoco payables_company_supplier_invoice_installment_key.
-- La rata 1 (aperta, 21.610,68 EUR in totale) NON viene toccata: resta da
-- verificare con Sabrina se GRUPPO FB ha davvero ancora questi 4 effetti da incassare.
--
-- Backup pre-modifica: public._bkp_gruppofb_rate_etichette_20260903 (8 righe complete).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public._bkp_gruppofb_rate_etichette_20260903 AS
SELECT * FROM public.payables WHERE id IN (
  'd148e38d-de6d-4bde-8957-298a9decb247','85d78927-dce2-4705-b224-0bc6a8e6c8e0',
  'fcb7bb59-5c41-4766-854f-466a7cd48768','9274558b-641a-4cc7-8225-f0ca1b54c551',
  'b5dff67f-97e0-4ea0-8687-f32f1de6c351','d1dcae68-2e95-41eb-be49-9c00954a8a4e',
  'ba704aab-16fa-4591-ac7b-d77827240ec9','bdf94a6c-cb1d-4d60-86ca-e1b1afd92110');

-- 1) rate oggi "2" (pagate dalla RiBa del 31/08) in parcheggio
UPDATE public.payables SET installment_number = 99
WHERE id IN ('d148e38d-de6d-4bde-8957-298a9decb247','fcb7bb59-5c41-4766-854f-466a7cd48768',
             'b5dff67f-97e0-4ea0-8687-f32f1de6c351','ba704aab-16fa-4591-ac7b-d77827240ec9');

-- 2) rate oggi "3" (pagate il 31/07 senza movimento) -> rata 2, scadenza 31/07
UPDATE public.payables SET installment_number = 2, original_due_date = '2026-07-31', due_date = '2026-07-31',
  notes = coalesce(notes,'') || ' | Etichetta rata riallineata 03/09/2026: era rata 3 (31/08), pagata il 31/07 quindi e'' la rata 2'
WHERE id IN ('85d78927-dce2-4705-b224-0bc6a8e6c8e0','9274558b-641a-4cc7-8225-f0ca1b54c551',
             'd1dcae68-2e95-41eb-be49-9c00954a8a4e','bdf94a6c-cb1d-4d60-86ca-e1b1afd92110');

-- 3) rate in parcheggio -> rata 3, scadenza 31/08 (coerente con l'addebito del 31/08)
UPDATE public.payables SET installment_number = 3, original_due_date = '2026-08-31', due_date = '2026-08-31',
  notes = coalesce(notes,'') || ' | Etichetta rata riallineata 03/09/2026: era rata 2 (31/07), pagata dalla RiBa del 31/08 quindi e'' la rata 3'
WHERE id IN ('d148e38d-de6d-4bde-8957-298a9decb247','fcb7bb59-5c41-4766-854f-466a7cd48768',
             'b5dff67f-97e0-4ea0-8687-f32f1de6c351','ba704aab-16fa-4591-ac7b-d77827240ec9');

-- 4) traccia in payable_actions
INSERT INTO public.payable_actions (payable_id, action_type, old_status, new_status, old_due_date, new_due_date, amount, note, operator_name)
SELECT b.id, 'riallineamento_rate', b.status, p.status, b.due_date, p.due_date, p.gross_amount,
  'Scambio etichette rate GRUPPO FB ' || p.invoice_number || ' del 03/09/2026: rata ' || b.installment_number || ' -> rata ' || p.installment_number || ' (i pagamenti restano dove sono; backup in _bkp_gruppofb_rate_etichette_20260903)', 'Claude Code'
FROM public._bkp_gruppofb_rate_etichette_20260903 b JOIN public.payables p ON p.id = b.id;

COMMIT;

-- VERIFICA
-- SELECT invoice_number, installment_number, due_date, status, payment_date, bank_transaction_id IS NOT NULL AS con_banca
-- FROM public.payables WHERE supplier_name ILIKE 'GRUPPO FB%' AND invoice_number IN ('2548','2704','3315','3480')
-- ORDER BY 1, 2;
-- Atteso per ogni fattura: rata 1 31/08 aperta | rata 2 31/07 pagata 31/07 senza banca | rata 3 31/08 pagata 31/08 con banca
