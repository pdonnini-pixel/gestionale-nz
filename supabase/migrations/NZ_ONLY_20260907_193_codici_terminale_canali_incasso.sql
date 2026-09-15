-- =====================================================================
-- NZ_ONLY 193 — Codici terminale e parole chiave dei canali di incasso
-- ---------------------------------------------------------------------
-- Dati di configurazione del tenant NZ (non uno schema): per ogni outlet
-- i codici terminale (ultime 5 cifre del codice SIA 6181087-000NN) dei
-- canali POS MPS, POS BCC e Amex, e la parola chiave del versamento del
-- canale Contanti. Ricavati dalle causali bancarie:
--   - BCC Valdarno (Numia/PagoBancomat): il nome dell'outlet e' in causale
--     (00005 PALMANOVA, 00006 FRANCIACORTA, 00010 BRUGNATO, 00012 VALMONTONE,
--     00014 SETTIMO/TORINO); 00001 e' l'unico terminale di gennaio 2025
--     (Valdichiana), 00003 resta per esclusione a Barberino.
--   - MPS (COD.SIA): prima transazione di ogni terminale = data di apertura
--     dell'outlet (00002 VDC 01/25, 00004 BRB 27/03/25, 00007 PLM 11/04/25,
--     00008 FRC 18/04/25, 00009 BRG 27/06/25, 00011 VLM 10/10/25, 00013 TRN 27/03/26).
--   - Amex accredita sul conto BCC con il codice del terminale BCC: i due
--     canali Amex di ogni outlet condividono quel codice (il matcher 192
--     confronta la somma).
--   - Versamenti: cassa continua MPS "CC FOIANO DELLA CHIANA" (VDC) e
--     "CC PALMANOVA" (PLM); ATM MPS 2121 con nota FRANCIACORTA; ATM MPS
--     con nota BRUGNATO; ATM MPS 1745 dal 21/10/25 (VLM, aperto 09/10/25);
--     ATM Intesa 9750 dal 31/03/26 (TRN, aperto 24/03/26); Banco Fiorentino
--     "cassa contin" (BRB, unico outlet su quel conto).
-- Applicata il 2026-09-07 via execute_sql (35 canali). Solo campi a NULL.
-- =====================================================================
WITH map(outlet_code, mps, bcc, kw, kw_bank_iban) AS (VALUES
  ('VDC','00002','00001','FOIANO',       NULL),
  ('BRB','00004','00003','cassa contin', 'IT77Y0832537730000000221949'),
  ('PLM','00007','00005','PALMANOVA',    NULL),
  ('FRC','00008','00006','FRANCIACORTA|ATM 01030-2121', NULL),
  ('BRG','00009','00010','BRUGNATO',     NULL),
  ('VLM','00011','00012','ATM 01030-1745', NULL),
  ('TRN','00013','00014','ATM 9750',     NULL)
)
UPDATE public.outlet_payment_channels ch
   SET terminal_code = CASE
         WHEN ch.kind = 'pos' AND ch.label ILIKE '%MPS%' THEN m.mps
         WHEN ch.kind = 'pos' AND ch.label ILIKE '%BCC%' THEN m.bcc
         WHEN ch.kind = 'pos_amex' THEN m.bcc
         WHEN ch.kind = 'contanti' THEN m.kw
         ELSE ch.terminal_code END,
       bank_account_id = CASE WHEN ch.kind = 'contanti' AND m.kw_bank_iban IS NOT NULL
                              THEN (SELECT ba.id FROM public.bank_accounts ba WHERE ba.account_name = m.kw_bank_iban LIMIT 1)
                              ELSE ch.bank_account_id END,
       updated_at = now()
  FROM map m JOIN public.outlets o ON o.code = m.outlet_code AND o.company_id = ch.company_id
 WHERE ch.outlet_id = o.id AND ch.is_active
   AND ch.kind IN ('pos','pos_amex','contanti')
   AND ch.terminal_code IS NULL;
