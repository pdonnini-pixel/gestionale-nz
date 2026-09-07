-- =============================================================================
-- NZ_ONLY 183 — Chiusure da go-live: agganciata la prova bancaria dove esiste
-- =============================================================================
-- DOMANDA DA CUI NASCE (Patrizio, 04/09/2026)
--   "REMAS ANTINCENDIO 178/00 del 26/01/2026 la dà pagata ma senza un
--   collegamento a un dato ufficiale, estratto conto o movimento. Perché?"
--
--   Perché è una chiusura del GO-LIVE: payable_actions registra l'azione
--   'payment' con nota "pagamento go live" il 17/06/2026 alle 14:12. All'avvio
--   tutto il pregresso è stato dichiarato saldato in blocco, senza passare dalla
--   riconciliazione bancaria. Nello Scadenzario quelle righe mostrano
--   "Pagato · 17/06" in grigio: registrata pagata, nessun movimento agganciato.
--
--   Sono 424 scadenze per 504.333,58 €. I movimenti bancari però partono dal
--   02/01/2025: per una parte di quelle chiusure la prova esiste, semplicemente
--   non è mai stata collegata.
--
-- COSA FA QUESTA MIGRATION
--   Aggancia il movimento reale alle chiusure go-live dove la prova è certa.
--   Criterio, tutti e tre i requisiti insieme:
--     1. importo esatto (≤ 0,02) sul lordo o sul netto CBI;
--     2. data del movimento >= data fattura e <= scadenza + 180 giorni;
--     3. PROVA DI IDENTITÀ in causale: nome del fornitore (regola stretta
--        supplier_confirmed_in_text) oppure numero della fattura;
--     4. abbinamento univoco nei due sensi: un solo movimento per quella
--        scadenza e una sola scadenza per quel movimento.
--
--   Le scadenze restano PAGATE: cambia solo che ora portano la prova bancaria.
--   payment_date passa dal 17/06 convenzionale alla data vera dell'uscita.
--
-- NUMERI (verificati prima dell'esecuzione)
--    424  chiuse al go-live senza movimento          504.333,58 €
--     89  hanno un movimento libero di pari importo
--     23  di queste hanno anche una prova d'identità
--     12  sono certe e sono state agganciate          16.219,18 €
--   Le 50 che combaciano solo per importo, senza nulla in causale che dica di
--   chi si tratta, NON sono state toccate: sarebbe indovinare.
--
-- LE 12 COPPIE
--   CT Industrie 4              12.916,14  bonifico 15/04 "SALDO FATTURA 4"
--   Geom. Marchetti Mirko 24     1.081,00  bonifico 13/04 "SALDO FATTURA 24"
--   O.C.R. System 1/489          1.037,00  bonifico 15/04 "SALDO FATTURA 489"
--   La Favorita 592                335,04  bonifico 17/04 "SALDO FATTURA 592"
--   Corte delle Fucine 725/2026    220,36  POS Buttrio 20/03
--   Ca Rocca 116                   211,00  POS Monselice 16/02
--   Corte delle Fucine 444/2026    154,00  POS Buttrio 20/02
--   La Mafaldina Monselice          95,50  POS Monselice 13/02
--   CNH Industrial LNC15978         62,58  SDD 21/05
--   Zena FE03238/542                40,03  POS ENI 03238 Monselice 23/02
--   Cosimo de Medici 2665/2026      36,50  bonifico 22/04 "SALDO FATTURA 2665"
--   Zena FE03238/543                30,03  POS ENI 03238 Monselice 23/02
--
--   Sulle due Zena l'identità non viene dal nome ma dal codice 03238 del
--   distributore ENI, che compare sia nel numero della fattura sia nella causale
--   del POS. Importi e date coerenti.
--
-- Nota su REMAS 178/00, la fattura della domanda: la sua prova NON esiste.
-- L'unico bonifico da 36,60 nel periodo (16/02/2026) cita "SALDO FATTURA 136" ed
-- è di T&T ANTINCENDIO DI ANTONIO TANCREDI (P.IVA 01891090514), fornitore diverso
-- da REMAS (01485720518) che per coincidenza fattura lo stesso importo.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE golive_pair(payable_id uuid, bt_id uuid) ON COMMIT DROP;
INSERT INTO golive_pair VALUES
 ('13323c39-7c31-4934-911c-b827f44a75dc','8650610f-3aeb-4f8a-9967-13b4a4f78ace'),
 ('3f7ce38d-d37a-46cc-b4ec-e4676224e5e4','fa60f964-5e48-49c9-a495-63be6d9d97d3'),
 ('7fd4818b-ebb7-4029-8b24-ed22c001a5ee','3a7dba9b-7a70-4b89-881f-4f87e657da8d'),
 ('61a23290-4770-45b3-868b-f689627b0d89','7403049b-9a98-491f-a637-855d2c8ae8b3'),
 ('7576297c-ee33-4298-8b83-7bfd2ab2c0f4','be13f644-fe89-465e-99d6-9d1a0c2b6ead'),
 ('a8f8f4cd-d2ec-4891-af67-21f065d0823d','e8816b70-c99d-412c-9c5e-874a29cf6790'),
 ('79175165-308c-44c9-9aa0-7e34fbef7874','6a62f0a1-32b6-45a5-9a88-2a309363b9a2'),
 ('faf77f11-ea1a-4310-aad1-1befd1e08cd4','c252154d-b776-472f-a22b-cafae472e460'),
 ('c9fd9e0e-97a8-4229-b969-998cc68fdfd3','dc67d1cb-515d-40bf-8c2e-ece22c005b8c'),
 ('7cd3a0e3-53b6-4248-a469-e260884f7161','dcbb23ed-cede-4aaa-91fb-648ac31e00b4'),
 ('7d0c066f-0fb8-48d5-8758-599ed939d5df','6409106f-4dad-43e2-a054-428e8210b4d8'),
 ('25ef4fe9-5f51-4c48-a6ec-7df2196ad616','34df1ba5-912d-4318-a0e3-a15520f3c0ea');

UPDATE public.payables p
SET bank_transaction_id = g.bt_id,
    payment_date = bt.transaction_date,
    closed_manually = false,
    updated_at = now()
FROM golive_pair g JOIN public.bank_transactions bt ON bt.id = g.bt_id
WHERE p.id = g.payable_id;

UPDATE public.bank_transactions bt
SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = g.payable_id
FROM golive_pair g WHERE bt.id = g.bt_id;

INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
SELECT p.company_id, g.bt_id, g.payable_id, 'manual', 95, 'applied', p.gross_amount,
       'prova bancaria per una chiusura go-live (04/09/2026): movimento con fornitore o numero fattura in causale, importo esatto, unico candidato'
FROM golive_pair g JOIN public.payables p ON p.id = g.payable_id;

COMMIT;

-- VERIFICA: 12 righe agganciate, tutte ancora in stato 'pagato'.
