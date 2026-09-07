-- =============================================================================
-- NZ_ONLY — Doppioni residui del lotto 10/07/2026 e rate MIAN nascoste per errore
-- Applicato su NZ il 04/09/2026 via MCP. Dati NZ-specifici: non si replica.
-- Solo UPDATE, nessun DELETE. Backup in public._bkp_doppioni_20260904.
-- =============================================================================
--
-- COME SONO EMERSI. Controllo chiesto da Patrizio dopo il caso SIGNORINI 563
-- («ci sono altri fornitori con lo stesso problema?»). Sulla ritenuta d'acconto
-- no: le 9 fatture NZ con ritenuta tornano tutte. Allargando il controllo alle
-- fatture le cui rate non sommano al totale, e alle righe aperte che duplicano
-- righe gia' pagate, sono usciti due filoni diversi. Tutti i casi sono anteriori
-- al 31/07/2026, quindi il pannello anomalie (che parte da quella data) non li
-- vede.
--
-- FILONE 1 — lotto del 10/07/2026 alle 06:48/06:49.
--   Quel lotto ha inserito righe con installment_total NULL sopra rate gia'
--   esistenti della stessa fattura. La dedup (080/098) lavora sulla chiave
--   (electronic_invoice_id, coalesce(installment_number,1)): con
--   installment_number 2 o 3 le righe sono passate. Le MINGARDO dello stesso
--   lotto erano gia' state annullate, le TANESINI gia' nascoste. Restavano vive:
--
--   a) faliero grafica snc 149/2026 del 23/06 (totale 447,01)
--      Rate vere 223,51 (31/08) + 223,50 (30/09), entrambe chiuse
--      dall'allineamento al file di Sabrina del 10/07. La riga 664ab77d da
--      447,01 al 30/09 e' l'intera fattura di nuovo, ancora APERTA.
--      -> 447,01 di debito che non esiste, l'unico caso con impatto sul da pagare.
--
--   b) GLS ENTERPRISE 959581 del 30/06 (totale 157,53)
--      Rata vera 53be5524, chiusa il 31/07 da distinta. La riga c4ebb2e6 e' la
--      stessa fattura, chiusa a mano il 03/09. Pagato registrato due volte.
--
--   c) MCA SRL 00494/2026/FPR del 12/06 (totale 76,50)
--      Rate vere 75,00 + 1,50 = 76,50, chiuse al go-live. La riga f0639693 da
--      76,50 e' la fattura intera di nuovo. Pagato registrato due volte.
--
--   Le tre righe vengono ANNULLATE (stessa scelta fatta per le MINGARDO del
--   lotto), con amount_paid e payment_date azzerati sulle due gia' chiuse, cosi'
--   non pesano piu' su nessun totale di pagato.
--
-- FILONE 2 — ripulitura doppioni del 06/08/2026 troppo aggressiva su MIAN.
--   Le fatture 379, 394, 397 e 400 hanno un piano che divide l'importo in TRE
--   RATE IDENTICHE per costruzione. Il controllo «doppione identico» le ha
--   scambiate per copie e ne ha nascosta una a testa (is_placeholder = true, che
--   la vista v_payables_operative esclude). Prova che erano rate vere: le tre
--   rate sommano al centesimo al totale della fattura, con due sole non torna.
--
--     379: 3 x 1.321,26 = 3.963,78 (visibile 2.642,52)
--     394: 3 x 2.253,34 = 6.760,02 (visibile 4.506,68)
--     397: 3 x 1.407,88 = 4.223,64 (visibile 2.815,76)
--     400: 3 x   409,92 = 1.229,76 (visibile   819,84)
--
--   Tutte gia' pagate: nessun debito aperto, ma il pagato verso MIAN risultava
--   piu' basso del vero di 5.392,40, e con esso i costi di marzo.
--   Le quattro righe tornano visibili.
--
-- NON TOCCATE: le 54 righe nascoste che sono documenti reverse charge
-- (TD16/TD17/TD18) e le due TANESINI 8/1789 e 8/1791, dove la riga nascosta era
-- davvero di troppo (fattura da 2 rate con 3 righe).
--
-- 7 UPDATE + 7 righe di audit.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public._bkp_doppioni_20260904 AS
SELECT * FROM public.payables WHERE id IN (
  -- filone 1: doppioni da annullare
  '664ab77d-8607-479f-b77f-ed4e80299bd0',  -- faliero 149/2026, 447,01 aperta
  'c4ebb2e6-6e53-4886-94f1-c2037b1a5b5b',  -- GLS 959581, 157,53 pagata due volte
  'f0639693-93dd-4066-abc3-66231d7f0f33',  -- MCA 00494/2026/FPR, 76,50 pagata due volte
  -- filone 2: rate MIAN nascoste per errore
  'a8029eb7-9afb-4fa3-99ee-61521afb00b9',  -- MIAN 379 rata 1
  'bb2af2de-d173-46b2-901e-0257948bc89d',  -- MIAN 394 rata 1
  '4528b922-d462-4e1c-a63b-b1aefe5f9f2b',  -- MIAN 397 rata 3
  'd2f3bf34-61a2-4da4-8442-3e9ac91d1e37'   -- MIAN 400 rata 3
);

ALTER TABLE public._bkp_doppioni_20260904 ENABLE ROW LEVEL SECURITY;

-- ── FILONE 1a: faliero, la riga aperta di troppo ────────────────────────────
UPDATE public.payables
   SET status = 'annullato'::payable_status,
       notes = coalesce(nullif(notes,''),'') || CASE WHEN coalesce(notes,'') <> '' THEN ' | ' ELSE '' END
               || 'Annullata il 04/09/2026: doppione della fattura 149/2026, gia'' chiusa nelle due rate da 223,51 e 223,50 (totale 447,01). Riga aggiunta dal lotto del 10/07/2026 con installment_total vuoto.'
 WHERE id = '664ab77d-8607-479f-b77f-ed4e80299bd0'
   AND status::text = 'da_pagare' AND gross_amount = 447.01;

-- ── FILONE 1b/1c: doppioni gia' chiusi, il pagato va tolto ──────────────────
UPDATE public.payables
   SET status = 'annullato'::payable_status,
       amount_paid = 0,
       payment_date = NULL,
       closed_manually = false,
       is_provisional_paid = false,
       notes = coalesce(nullif(notes,''),'') || CASE WHEN coalesce(notes,'') <> '' THEN ' | ' ELSE '' END
               || 'Annullata il 04/09/2026: doppione della fattura 959581, gia'' chiusa il 31/07/2026 da distinta sulla riga 53be5524-3c28-480a-acc1-38c9d5a31d6c. Il pagamento vero e'' uno solo: 157,53, non 315,06.'
 WHERE id = 'c4ebb2e6-6e53-4886-94f1-c2037b1a5b5b'
   AND gross_amount = 157.53;

UPDATE public.payables
   SET status = 'annullato'::payable_status,
       amount_paid = 0,
       payment_date = NULL,
       closed_manually = false,
       is_provisional_paid = false,
       notes = coalesce(nullif(notes,''),'') || CASE WHEN coalesce(notes,'') <> '' THEN ' | ' ELSE '' END
               || 'Annullata il 04/09/2026: doppione della fattura 00494/2026/FPR, gia'' chiusa nelle due rate da 75,00 e 1,50 (totale 76,50). Il pagamento vero e'' uno solo: 76,50, non 153,00.'
 WHERE id = 'f0639693-93dd-4066-abc3-66231d7f0f33'
   AND gross_amount = 76.50;

-- ── FILONE 2: le quattro rate MIAN tornano visibili ─────────────────────────
UPDATE public.payables
   SET is_placeholder = false,
       notes = replace(coalesce(notes,''),
                       ' | Doppione identico rimosso (nascosto) 2026-08-06 - riga duplicata, tenuta una copia. Reversibile.',
                       '')
               || ' | Rimessa visibile il 04/09/2026: non era un doppione. Il piano MIAN divide la fattura in tre rate identiche, le tre sommano al totale, con due sole mancava un terzo.'
 WHERE id IN ('a8029eb7-9afb-4fa3-99ee-61521afb00b9',
              'bb2af2de-d173-46b2-901e-0257948bc89d',
              '4528b922-d462-4e1c-a63b-b1aefe5f9f2b',
              'd2f3bf34-61a2-4da4-8442-3e9ac91d1e37')
   AND is_placeholder = true;

-- ── traccia ────────────────────────────────────────────────────────────────
INSERT INTO public.payable_actions (payable_id, action_type, old_status, new_status, amount, note, operator_name)
VALUES
 ('664ab77d-8607-479f-b77f-ed4e80299bd0', 'annullamento_doppione', 'da_pagare', 'annullato', 447.01,
  'Doppione faliero grafica 149/2026 dal lotto del 10/07/2026: la fattura era gia'' coperta dalle due rate da 223,51 e 223,50. Era l''unico debito aperto inesistente trovato nel controllo del 04/09.', 'Fix doppioni 04/09'),
 ('c4ebb2e6-6e53-4886-94f1-c2037b1a5b5b', 'annullamento_doppione', 'pagato', 'annullato', 157.53,
  'Doppione GLS ENTERPRISE 959581 dal lotto del 10/07/2026. Pagato registrato due volte: azzerati amount_paid e payment_date.', 'Fix doppioni 04/09'),
 ('f0639693-93dd-4066-abc3-66231d7f0f33', 'annullamento_doppione', 'pagato', 'annullato', 76.50,
  'Doppione MCA SRL 00494/2026/FPR dal lotto del 10/07/2026. Pagato registrato due volte: azzerati amount_paid e payment_date.', 'Fix doppioni 04/09'),
 ('a8029eb7-9afb-4fa3-99ee-61521afb00b9', 'ripristino_rata', 'pagato', 'pagato', 1321.26,
  'MIAN 379 rata 1: nascosta per errore il 06/08/2026 come doppione. Le tre rate identiche sommano al totale 3.963,78, non erano copie.', 'Fix doppioni 04/09'),
 ('bb2af2de-d173-46b2-901e-0257948bc89d', 'ripristino_rata', 'pagato', 'pagato', 2253.34,
  'MIAN 394 rata 1: nascosta per errore il 06/08/2026 come doppione. Le tre rate identiche sommano al totale 6.760,02.', 'Fix doppioni 04/09'),
 ('4528b922-d462-4e1c-a63b-b1aefe5f9f2b', 'ripristino_rata', 'pagato', 'pagato', 1407.88,
  'MIAN 397 rata 3: nascosta per errore il 06/08/2026 come doppione. Le tre rate identiche sommano al totale 4.223,64.', 'Fix doppioni 04/09'),
 ('d2f3bf34-61a2-4da4-8442-3e9ac91d1e37', 'ripristino_rata', 'pagato', 'pagato', 409.92,
  'MIAN 400 rata 3: nascosta per errore il 06/08/2026 come doppione. Le tre rate identiche sommano al totale 1.229,76.', 'Fix doppioni 04/09');

COMMIT;

-- =============================================================================
-- VERIFICA
-- Nessuna fattura con rate che non sommano all'importo da pagare:
-- select e.supplier_name, e.invoice_number, e.gross_amount - coalesce(e.withholding_amount,0) as atteso,
--        sum(p.gross_amount) as visibili
--   from electronic_invoices e
--   join payables p on p.electronic_invoice_id = e.id
--    and p.status::text <> 'annullato' and coalesce(p.is_placeholder,false) = false
--  where e.gross_amount is not null and e.gross_amount <> 0
--  group by e.id, e.supplier_name, e.invoice_number, e.gross_amount, e.withholding_amount
-- having abs(sum(p.gross_amount) - case when upper(coalesce(e.tipo_documento,'')) in ('TD04','TD08')
--             then -abs(e.gross_amount) else e.gross_amount - coalesce(e.withholding_amount,0) end)
--        > greatest(0.05, abs(e.gross_amount)*0.001);
-- atteso: zero righe
-- =============================================================================
