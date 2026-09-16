-- NZ_ONLY — 2026-09-16 — Il terzo movimento perso dalla stessa cucitura fra import.
--
-- Rileggendo l'estratto conto MPS di maggio 2026 (04/05-04/06, 511 entrate) e confrontandolo
-- importo per importo con bank_transactions, manca una riga sola: un accredito POS di 79,33 euro
-- contabilizzato il 04/05 con DATA RIF. 30.04.26, terminale 6181087-00007, cioe' **Palmanova**,
-- circuito BANCOMAT (CBI 0909).
--
-- E' lo stesso difetto della migration 234: valuta e data riferimento in aprile, contabile in
-- maggio, quindi la corsa di aprile e quella di maggio se lo sono passato senza prenderlo.
-- Il gemello internazionale dello stesso giorno e dello stesso terminale (1.302,29, CBI 0941)
-- c'e'; manca solo la parte bancomat.
--
-- PERCHE' CONTA
-- Palmanova il 30/04 dichiara 1.391,92 di POS e in banca ne risultavano 1.302,29, cioe' -6,4 %:
-- l'unica differenza POS di tutta la ricostruzione troppo grande per essere commissione. Con i
-- 79,33 recuperati diventa 1.381,62 contro 1.391,92, -0,74 %, in linea con tutte le altre.
--
-- NESSUN VALORE HARDCODED: conto e azienda si ricavano dai dati vivi.

BEGIN;

WITH conto AS (
  SELECT ba.id AS bank_account_id, ba.company_id
  FROM public.bank_accounts ba
  WHERE lower(coalesce(ba.bank_name, '')) LIKE '%mps%'
     OR lower(coalesce(ba.bank_name, '')) LIKE '%monte dei paschi%'
  ORDER BY ba.created_at
  LIMIT 1
)
INSERT INTO public.bank_transactions
  (company_id, bank_account_id, transaction_date, value_date, amount, currency,
   status, source, is_reconciled, description, note)
SELECT c.company_id, c.bank_account_id,
       DATE '2026-05-04', DATE '2026-05-04',
       79.33, 'EUR', 'posted', 'estratto_conto', false,
       'Causale: INCASSO TRAMITE P.O.S. - Descrizione: ACCREDITO POS - COD.SIA:6181087-00007 CBI:0909 INSEGNA: VICOLO ID: 1241290738 DATA RIF.: 30.04.26 CIRCUITO: BANCOMAT CODICE CONVENZIONE: 1000001392694',
       'inserito il 16/09/2026 dall''estratto conto MPS di maggio 2026: accredito POS Palmanova del 30/04 sfuggito alla cucitura fra l''import di aprile e quello di maggio'
FROM conto c
WHERE NOT EXISTS (
  SELECT 1 FROM public.bank_transactions x
   WHERE x.bank_account_id = c.bank_account_id
     AND x.amount = 79.33
     AND x.transaction_date BETWEEN DATE '2026-04-25' AND DATE '2026-05-10'
     AND x.description LIKE '%00007%'
);

COMMIT;

-- VERIFICHE
-- a) i due accrediti da 79,33 del 04/05, uno per terminale
--    SELECT transaction_date, amount, substring(description from 'COD.SIA:[0-9-]+')
--      FROM public.bank_transactions WHERE amount = 79.33 AND transaction_date = '2026-05-04';
--    atteso: 2 righe, COD.SIA 6181087-00004 e 6181087-00007
-- b) dopo il riscontro, la riga POS di Palmanova del 30/04 non e' piu' in differenza
