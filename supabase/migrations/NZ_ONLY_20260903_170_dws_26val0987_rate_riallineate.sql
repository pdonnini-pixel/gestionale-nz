-- =============================================================================
-- NZ_ONLY — DWS GRUNDBESITZ 26VAL-0987: i due SDD tornano sulle rate giuste
-- Applicato su NZ il 03/09/2026. Dati NZ-specifici: non si replica su Made/Zago.
-- =============================================================================
--
-- IL FATTO. Segnalazione di Patrizio dalla tab Movimenti: «c'e' il movimento ma
-- me lo hai lasciato aperto tra le scadenze ma lo dai per riconciliato».
-- La fattura 26VAL-0987 (1/7/2026, 35.785,87 in tre rate SDD) stava cosi':
--
--   rata 1  11.927,43  scad. 13/07  SCADUTA, nessun movimento agganciato
--   rata 2  11.927,43  scad. 10/08  pagata, agganciata all'SDD del 13/07
--   rata 3  11.931,01  scad. 10/09  pagata, agganciata all'SDD del 10/08 (11.927,43)
--
-- In banca sono usciti due SDD da 11.927,43, il 13/07 e il 10/08: sono le rate 1 e
-- 2, pagate puntuali. Il motore le aveva agganciate alle rate 2 e 3 (la rata 1 era
-- placeholder il 23/07; il 10/08 il tetto a 100 del punteggio ha fatto vincere la
-- prima riga letta, vedi migration 170). La rata 3 non e' ancora scaduta e non e'
-- stata pagata.
--
-- COSA CAMBIA (solo UPDATE, nessuna riga cancellata):
--   SDD 13/07 (3a1cc5d1) -> rata 1 (93adf114): pagata il 13/07
--   SDD 10/08 (44471313) -> rata 2 (3d73d027): pagata il 10/08
--   rata 3 (b76fc7e6): riaperta, 11.931,01 da pagare al 10/09
-- Totale pagato prima: 23.858,44 (11.927,43 + 11.931,01). Dopo: 23.854,86, che e'
-- la somma vera dei due movimenti. Debito residuo verso DWS su questa fattura:
-- 11.931,01 invece di 11.927,43.
--
-- Backup pre-modifica: _bkp_dws_rate_20260903 (3 payables), _bkp_dws_bt_20260903
-- (2 bank_transactions), _bkp_dws_rlog_20260903 (2 reconciliation_log).
-- Il rollback a fianco ripristina esattamente quello stato.
-- =============================================================================

BEGIN;

-- 1) Backup
CREATE TABLE public._bkp_dws_rate_20260903 AS
  SELECT p.*, now() AS bkp_at FROM public.payables p
  WHERE p.id IN ('93adf114-8794-4cd5-90e7-34c28b9f67b9',
                 '3d73d027-0f12-4148-9b82-4f1a7e462f22',
                 'b76fc7e6-0524-4ac4-b2b4-d78e3a8d03d7');
CREATE TABLE public._bkp_dws_bt_20260903 AS
  SELECT bt.*, now() AS bkp_at FROM public.bank_transactions bt
  WHERE bt.id IN ('3a1cc5d1-36bc-4049-a90b-c32d7e2ac69c',
                  '44471313-5778-45a4-86c8-7bbec771b05b');
CREATE TABLE public._bkp_dws_rlog_20260903 AS
  SELECT l.*, now() AS bkp_at FROM public.reconciliation_log l
  WHERE l.id IN ('1f3e6b7b-8051-41e0-a775-e0d797d2775c',
                 '2dd257f2-e7ab-4123-876c-08039ab8f492');

-- 2) Sgancio: rata 2 e rata 3 perdono il movimento (la rata 3 torna aperta)
UPDATE public.payables
   SET bank_transaction_id = NULL, amount_paid = 0, payment_date = NULL
 WHERE id = 'b76fc7e6-0524-4ac4-b2b4-d78e3a8d03d7';   -- rata 3
UPDATE public.payables
   SET bank_transaction_id = NULL
 WHERE id = '3d73d027-0f12-4148-9b82-4f1a7e462f22';   -- rata 2

-- 3) Riaggancio sulle rate giuste (il trigger update_payable_status ricalcola stato e residuo)
UPDATE public.payables
   SET bank_transaction_id = '3a1cc5d1-36bc-4049-a90b-c32d7e2ac69c',
       amount_paid = 11927.43, payment_date = DATE '2026-07-13'
 WHERE id = '93adf114-8794-4cd5-90e7-34c28b9f67b9';   -- rata 1
UPDATE public.payables
   SET bank_transaction_id = '44471313-5778-45a4-86c8-7bbec771b05b',
       amount_paid = 11927.43, payment_date = DATE '2026-08-10'
 WHERE id = '3d73d027-0f12-4148-9b82-4f1a7e462f22';   -- rata 2

-- 4) I movimenti puntano alla rata giusta
UPDATE public.bank_transactions SET reconciled_invoice_id = '93adf114-8794-4cd5-90e7-34c28b9f67b9'
 WHERE id = '3a1cc5d1-36bc-4049-a90b-c32d7e2ac69c';
UPDATE public.bank_transactions SET reconciled_invoice_id = '3d73d027-0f12-4148-9b82-4f1a7e462f22'
 WHERE id = '44471313-5778-45a4-86c8-7bbec771b05b';

-- 5) Audit: i vecchi agganci restano nel log come respinti, i nuovi come manuali
UPDATE public.reconciliation_log
   SET status = 'rejected',
       notes = COALESCE(notes, '') || ' | riallineamento 03/09/2026: movimento agganciato alla rata sbagliata (vedi NZ_ONLY_170)'
 WHERE id IN ('1f3e6b7b-8051-41e0-a775-e0d797d2775c', '2dd257f2-e7ab-4123-876c-08039ab8f492');
INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
VALUES
  ((SELECT company_id FROM public.payables WHERE id = '93adf114-8794-4cd5-90e7-34c28b9f67b9'),
   '3a1cc5d1-36bc-4049-a90b-c32d7e2ac69c', '93adf114-8794-4cd5-90e7-34c28b9f67b9',
   'manual', 100, 'applied', 11927.43,
   'riallineamento 03/09/2026: SDD del 13/07 e'' la rata 1 di 26VAL-0987 (era agganciato alla rata 2)'),
  ((SELECT company_id FROM public.payables WHERE id = '3d73d027-0f12-4148-9b82-4f1a7e462f22'),
   '44471313-5778-45a4-86c8-7bbec771b05b', '3d73d027-0f12-4148-9b82-4f1a7e462f22',
   'manual', 100, 'applied', 11927.43,
   'riallineamento 03/09/2026: SDD del 10/08 e'' la rata 2 di 26VAL-0987 (era agganciato alla rata 3)');

INSERT INTO public.payable_actions (payable_id, action_type, old_status, new_status, amount, note)
SELECT p.id, 'riallineamento_rate', b.status, p.status, p.gross_amount,
       'Riallineamento rate 26VAL-0987 del 03/09/2026: SDD 13/07 -> rata 1, SDD 10/08 -> rata 2, rata 3 riaperta (NZ_ONLY_170)'
  FROM public.payables p JOIN public._bkp_dws_rate_20260903 b ON b.id = p.id;

COMMIT;
