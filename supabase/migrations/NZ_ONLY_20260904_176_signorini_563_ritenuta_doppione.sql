-- =============================================================================
-- NZ_ONLY — SIGNORINI ASSOCIATI, fattura 563 del 14/07/2026: doppione chiuso
-- Applicato su NZ il 04/09/2026 via MCP. Dati NZ-specifici: non si replica.
-- =============================================================================
--
-- LA SEGNALAZIONE. Patrizio: la 563 da 4.648,88 risulta scaduta nello
-- scadenzario, ma l'estratto conto SIGNORINI al 03/09/2026 la da' chiusa.
-- Le uniche partite aperte del fornitore sono le notule 517 del 23/05
-- (5.475,46) e 765 del 04/08 (4.832,04), totale 10.307,50: nel gestionale
-- ci sono gia' entrambe (SPN_517 e «progetto notula 765»), stesso totale.
--
-- I NUMERI DELLA FATTURA (TD06, parcella con cassa e ritenuta):
--   imponibile 3.664,00 + cassa TC08 4% 146,56 = 3.810,56
--   IVA 22% 838,32 -> totale documento 4.648,88
--   ritenuta RT02 20% 732,80 -> DatiPagamento/ImportoPagamento 3.916,08 al 14/07
--
-- IL PAGAMENTO C'E'. Bonifico CBI del 13/07/2026, movimento
-- b7b9040b-b23d-4ef7-95ed-aaded74a4501, -3.917,83 (3.916,08 + 1,75 di
-- commissioni), agganciato alla riga SPN_32: e' la notula di quella parcella,
-- pagata il giorno prima che lo studio emettesse la fattura. Il flusso CBI non
-- riporta il nome del beneficiario: l'aggancio regge sull'importo al centesimo,
-- sulla data e sull'estratto conto.
--
-- PERCHE' ERANO DUE RIGHE. Il bridge A-Cube generava la scadenza sul TOTALE
-- DOCUMENTO invece che sull'importo da pagare (difetto sistemico corretto dalla
-- migration 20260904_176 sui 3 tenant), e l'aggancio notula<->fattura della 098
-- cerca la candidata per lordo uguale: 3.916,08 contro 4.648,88 non combacia,
-- differenza esattamente la ritenuta. Il merge si e' quindi attaccato a una
-- terza riga manuale da 4.648,88 inserita il 16/07, che e' quella rimasta
-- scaduta (c713508b).
--
-- COSA FA QUESTA MIGRATION (solo UPDATE, nessun DELETE)
--   1) electronic_invoices 563: withholding_amount da 0 a 732,80 (il valore che
--      fn_invoice_withholding ricalcola oggi dallo stesso payload).
--   2) payable c713508b (doppione da 4.648,88): annullato, e sganciato dalla
--      fattura elettronica e dall'acube_uuid per liberarli.
--   3) payable d4b0648c (SPN_32, la riga davvero pagata): assorbe la fattura,
--      come previsto dalla 098. Prende numero 563, data 14/07/2026, la fattura
--      elettronica, l'acube_uuid, la ritenuta di 732,80; net_amount e vat_amount
--      li ricalcola il trigger fn_payable_autofill_split (3.810,56 + 838,32).
--      Importo, stato pagato, movimento bancario e riconciliazione restano
--      quelli che erano. payment_date passa dal 10/07 (data della chiusura a
--      mano) al 13/07, che e' la data vera del bonifico gia' agganciato.
--      La scadenza resta al 30/06/2026, dove l'aveva messa Sabrina
--      («arretrato lavorato a giugno», payable_actions del 10/07): la 098 non
--      tocca la scadenza delle righe gia' pagate e non la tocchiamo neanche noi.
--
-- ESITO ATTESO: una sola riga SIGNORINI per la 563, da 3.916,08, pagata.
-- Aperto verso il fornitore restano 5.475,46 + 4.832,04 = 10.307,50, identico
-- all'estratto conto.
--
-- Backup integrale in public._bkp_signorini_563_20260904 (payables) e
-- public._bkp_signorini_563_ei_20260904 (electronic_invoices).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public._bkp_signorini_563_20260904 AS
SELECT * FROM public.payables
 WHERE id IN ('c713508b-9148-4497-8f8f-59ca66cb3683','d4b0648c-a818-416e-a65f-8ea6f2dc37d8');

CREATE TABLE IF NOT EXISTS public._bkp_signorini_563_ei_20260904 AS
SELECT id, company_id, invoice_number, invoice_date, supplier_name, supplier_vat,
       net_amount, vat_amount, gross_amount, withholding_amount, due_date, sdi_status, acube_uuid
  FROM public.electronic_invoices
 WHERE id = 'f7af3503-a760-41db-bcf1-6ef3d015bc18';

ALTER TABLE public._bkp_signorini_563_20260904 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_signorini_563_ei_20260904 ENABLE ROW LEVEL SECURITY;

-- 1) la fattura elettronica registra la ritenuta letta dal payload
UPDATE public.electronic_invoices
   SET withholding_amount = 732.80
 WHERE id = 'f7af3503-a760-41db-bcf1-6ef3d015bc18'
   AND coalesce(withholding_amount, 0) = 0;

-- 2) la riga doppione lascia libera la fattura e viene annullata
-- (invoice_number cambiato perche' l'indice unico
--  payables_company_supplier_invoice_installment_key non esclude gli annullati:
--  il numero 563 deve restare libero per la riga buona)
UPDATE public.payables
   SET electronic_invoice_id = NULL,
       acube_uuid = NULL,
       invoice_number = '563-DOPPIONE-ANNULLATO',
       status = 'annullato'::payable_status,
       notes = coalesce(notes,'') || ' | Annullata il 04/09/2026: doppione della notula SPN_32, stessa parcella 563 del 14/07/2026. Importo gonfiato della ritenuta d''acconto (4.648,88 invece di 3.916,08). La riga buona e'' d4b0648c-a818-416e-a65f-8ea6f2dc37d8, pagata col bonifico del 13/07/2026.'
 WHERE id = 'c713508b-9148-4497-8f8f-59ca66cb3683';

-- 3) la notula pagata assorbe la fattura vera
UPDATE public.payables
   SET invoice_number = '563',
       invoice_date = DATE '2026-07-14',
       electronic_invoice_id = 'f7af3503-a760-41db-bcf1-6ef3d015bc18',
       acube_uuid = '019f8d16-9e21-796f-a856-13659019abf2',
       withholding_amount = 732.80,
       payment_method = 'bonifico_ordinario'::payment_method,
       payment_method_code = 'MP05',
       payment_method_label = public.fn_sdi_mp_label('MP05'),
       payment_date = DATE '2026-07-13',
       manual_close_reason = 'Notula SPN_32 pagata col bonifico CBI del 13/07/2026 (3.916,08 + 1,75 commissioni). Il 14/07 lo studio ha emesso la parcella 563: stesso importo al netto della ritenuta.',
       notes = coalesce(nullif(notes,''),'') || CASE WHEN coalesce(notes,'') <> '' THEN ' ' ELSE '' END
               || '[Notula SPN_32 assorbita dalla fattura SDI 563 del 14/07/2026 — totale documento 4.648,88, ritenuta d''acconto RT02 20% 732,80, da pagare 3.916,08. Riga doppione c713508b annullata il 04/09/2026. Scadenza lasciata al 30/06/2026 come da allineamento di Sabrina.]'
 WHERE id = 'd4b0648c-a818-416e-a65f-8ea6f2dc37d8';

-- traccia
INSERT INTO public.payable_actions (payable_id, action_type, old_status, new_status, amount, note, operator_name)
VALUES
 ('c713508b-9148-4497-8f8f-59ca66cb3683', 'annullamento_doppione', 'scaduto', 'annullato', 4648.88,
  'Doppione della parcella SIGNORINI 563: importo al lordo della ritenuta d''acconto (4.648,88 invece di 3.916,08). Debito gia'' chiuso sulla riga SPN_32 col bonifico del 13/07/2026. Estratto conto fornitore al 03/09/2026: la 563 non e'' fra le partite aperte.', 'Fix ritenuta 04/09'),
 ('d4b0648c-a818-416e-a65f-8ea6f2dc37d8', 'merge_notula_fattura', 'pagato', 'pagato', 3916.08,
  'La notula SPN_32 assorbe la fattura SDI 563 del 14/07/2026 (regola 098). Ritenuta 732,80 registrata, imponibile 3.810,56 + IVA 838,32, da pagare 3.916,08.', 'Fix ritenuta 04/09');

COMMIT;

-- =============================================================================
-- VERIFICA
-- select invoice_number, invoice_date, due_date, gross_amount, withholding_amount,
--        net_amount, vat_amount, amount_paid, status, payment_date, bank_transaction_id
--   from payables where supplier_vat = '06511620483' order by due_date;
-- atteso: 191 pagato 6.822,15 | 563 pagato 3.916,08 rit 732,80 | 563-DOPPIONE-ANNULLATO 4.648,88
--         | progetto notula 765 da_pagare 4.832,04 | SPN_517 da_pagare 5.475,46
--
-- select sum(gross_amount) from payables
--  where supplier_vat = '06511620483' and status not in ('pagato','annullato','nota_credito');
-- atteso: 10307.50 (= totale estratto conto SIGNORINI al 03/09/2026)
-- =============================================================================
