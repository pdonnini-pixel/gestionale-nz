-- NZ_ONLY_20260903_170_signorini_191_aggancio_movimento.sql
--
-- SOLO NZ (dati reali). Chiude il caso segnalato da Patrizio il 03/09/2026:
-- in Banche > Movimenti il bonifico del 06/03/2026 a SIGNORINI ASSOCIATI di
-- 6.822,15 € risultava «da riconciliare», mentre in Scadenzario la fattura 191
-- (09/03/2026) era chiusa a mano a 8.098,75 €. La differenza e' la ritenuta
-- d'acconto (1.276,60 €): con la migration 170 la scadenza vale ora 6.822,15 €
-- (dovuto al netto), cioe' esattamente il bonifico.
--
-- Qui si aggancia il movimento alla scadenza (nessun DELETE, nessun importo
-- toccato): la fattura era gia' 'pagato'; si registra il link, la data reale del
-- bonifico e una riga nel log di riconciliazione, come farebbe il motore.
--
-- Rollback: NZ_ONLY_20260903_170_signorini_191_aggancio_movimento_ROLLBACK.sql

BEGIN;

-- Scadenza fattura 191 SIGNORINI ASSOCIATI (gia' pagata, chiusa a mano)
UPDATE public.payables
   SET bank_transaction_id = '015f78a4-cdcc-418a-ac89-8aa235acdbe7',
       payment_date = DATE '2026-03-06',
       updated_at = now()
 WHERE id = '25fa0551-6b80-40c2-bd73-26d5d5796f36'
   AND bank_transaction_id IS NULL;

-- Movimento BCC 06/03/2026 −6.822,15 € «SIGNORINI ASSOCIATI S.S. SALDO PROGETTO DI NOTULA»
UPDATE public.bank_transactions
   SET is_reconciled = true,
       reconciled_at = now(),
       reconciled_invoice_id = '25fa0551-6b80-40c2-bd73-26d5d5796f36'
 WHERE id = '015f78a4-cdcc-418a-ac89-8aa235acdbe7'
   AND coalesce(is_reconciled, false) = false;

INSERT INTO public.reconciliation_log
  (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
SELECT p.company_id, '015f78a4-cdcc-418a-ac89-8aa235acdbe7', p.id, 'manual', 100, 'applied', 6822.15,
       'Aggancio manuale (migration 170): bonifico 06/03/2026 = fattura 191 al netto della ritenuta d''acconto (8.098,75 − 1.276,60 = 6.822,15)'
  FROM public.payables p
 WHERE p.id = '25fa0551-6b80-40c2-bd73-26d5d5796f36'
   AND NOT EXISTS (
     SELECT 1 FROM public.reconciliation_log l
      WHERE l.bank_transaction_id = '015f78a4-cdcc-418a-ac89-8aa235acdbe7'
        AND l.payable_id = p.id AND l.status = 'applied');

COMMIT;

-- Verifica:
-- select p.invoice_number, p.gross_amount, p.withholding_amount, p.status, p.payment_date, b.amount, b.is_reconciled
--   from payables p join bank_transactions b on b.id = p.bank_transaction_id
--  where p.id = '25fa0551-6b80-40c2-bd73-26d5d5796f36';
