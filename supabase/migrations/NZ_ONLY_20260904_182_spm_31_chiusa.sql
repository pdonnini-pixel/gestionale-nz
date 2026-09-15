-- =============================================================================
-- NZ_ONLY — Spm Investigazioni, fattura 31 del 26/02/2026: chiusura completata
-- Applicato su NZ il 04/09/2026 via MCP. Solo UPDATE. Backup in
-- public._bkp_spm31_20260904.
-- =============================================================================
--
-- IL CASO. Patrizio dallo Scadenzario: «cosa ci fa Spm tra le aperte se la dai
-- per chiusa?». La riga b1aa341b mostrava insieme lo stato «Scaduto» e il badge
-- «Chiusa a mano», con la colonna Conto «A mano · Lilian Mammoliti · 06/08».
--
-- PERCHE'. Due fonti diverse per la stessa domanda. Lo stato lo ricalcola
-- update_payable_status dall'importo pagato, che era 0. Il badge e la colonna
-- Conto leggono invece il flag closed_manually, rimasto acceso.
-- Nel partitario ci sono due sole azioni: il pagamento del go-live (17/06) e la
-- chiusura a mano di Lilian (06/08). Poi il 04/09 alle 09:07 UTC un UPDATE
-- diretto ha azzerato amount_paid senza spegnere il flag e senza registrare
-- l'azione «riapertura»: non e' passato da reopen_payable, che avrebbe fatto
-- entrambe le cose. Nello stesso secondo sono state toccate altre due righe
-- della distinta Intesa del 03/09.
--
-- LA VERITA' OPERATIVA. Patrizio conferma che la fattura e' stata pagata; data e
-- mezzo non li ha ancora. In banca non c'e' riscontro: i tre bonifici da 110,00
-- del 2026 portano causali esplicite e sono gia' assegnati (04/02 fattura 13,
-- 04/06 da 220,00 per le fatture 45 e 63, 14/07 fattura 81, 07/08 fattura 103).
-- Quindi si chiude a mano, senza movimento, usando come data quella dell'unica
-- chiusura registrata (06/08/2026) e dicendolo nel motivo: data e mezzo restano
-- da confermare.
--
-- 1 UPDATE + 1 riga di audit.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public._bkp_spm31_20260904 AS
SELECT * FROM public.payables WHERE id = 'b1aa341b-fa46-4db5-baad-cd1b43748c1d';

ALTER TABLE public._bkp_spm31_20260904 ENABLE ROW LEVEL SECURITY;

UPDATE public.payables
   SET amount_paid = gross_amount,
       payment_date = DATE '2026-08-06',
       closed_manually = true,
       manual_close_reason = 'Pagata (confermato da Patrizio il 04/09/2026). Data e mezzo non ancora noti: usata la data della chiusura a mano di Lilian del 06/08/2026, da correggere quando emergono. Nessun movimento bancario: i bonifici Spm del 2026 sono tutti gia'' assegnati ad altre fatture.',
       notes = coalesce(nullif(notes,''),'') || CASE WHEN coalesce(notes,'') <> '' THEN ' | ' ELSE '' END
               || 'Chiusa il 04/09/2026: il flag closed_manually era rimasto acceso su una riga con pagato a zero, da un UPDATE diretto del 04/09 che non e'' passato da reopen_payable.'
 WHERE id = 'b1aa341b-fa46-4db5-baad-cd1b43748c1d'
   AND coalesce(amount_paid,0) = 0;

INSERT INTO public.payable_actions (payable_id, action_type, old_status, new_status, amount, note, operator_name)
VALUES ('b1aa341b-fa46-4db5-baad-cd1b43748c1d', 'chiusura_manuale', 'scaduto', 'pagato', 110.00,
  'Chiusa a mano il 06/08/2026 (data della chiusura originale di Lilian). Pagamento confermato da Patrizio il 04/09/2026, data e mezzo da confermare. La riga era rimasta a meta'': flag di chiusura acceso e pagato a zero.',
  'Fix Spm 31 04/09');

COMMIT;

-- VERIFICA
-- select invoice_number, gross_amount, amount_paid, amount_remaining, status, closed_manually, payment_date
--   from payables where id = 'b1aa341b-fa46-4db5-baad-cd1b43748c1d';
-- atteso: 31 | 110,00 | 110,00 | 0,00 | pagato | true | 2026-08-06
