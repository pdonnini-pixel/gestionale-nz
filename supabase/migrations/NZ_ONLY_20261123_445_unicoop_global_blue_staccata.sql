-- =====================================================================
-- NZ_ONLY 445 — Stacca di nuovo l'aggancio UNICOOP / Global Blue, e stavolta resta staccato
-- =====================================================================
-- Solo NZ: è una correzione di dati, su una fattura e un movimento di NZ.
-- Da applicare DOPO la 443 (usa `escludi_coppia`).
--
-- La storia, per chi la legge fra sei mesi:
--  * 25/07/2026 — il ramo «abbinamento per data» aggancia la fattura UNICOOP
--    Firenze 044/000009 (250,00, scadenza 02/01/2026) all'addebito SDD del
--    06/03/2026 da 251,22. La fattura era già «pagato», quindi è stato solo un
--    aggancio: nessun importo toccato.
--  * 19/11/2026 — Patrizio guarda e dice che è sbagliato: quell'addebito è un
--    rimborso tax free Global Blue, e la spesa UNICOOP di 250,00 era stata
--    pagata con la carta BCC *3145 il 02/01/2026 (estratto carta di gennaio).
--    L'aggancio viene annullato e la nota finisce sulla fattura.
--  * 20/11/2026 alle 05:45 — il giro notturno rifà lo stesso aggancio.
--  * 23/11/2026 — controllo settimanale: lo stacco di nuovo e, con la 443,
--    la coppia entra nell'elenco di quelle escluse. La 444 toglie anche la
--    causa: la conferma del fornitore arrivava dalla parola «FIRENZE» che sta
--    nell'indirizzo del documento tax free.
--
-- COSA NON SI TOCCA (regola del punto 5 del giro settimanale): `status`,
-- `payment_date`, `amount_paid`, `closed_manually` restano come sono. La
-- fattura è pagata per davvero, con la carta, il 02/01/2026: l'aggancio
-- sbagliato era solo il collegamento al movimento. Per questo NON si usa
-- `undo_reconcile_movement`, che la riaprirebbe.
--
-- Backup prima della modifica (SELECT completa eseguita nella sessione del
-- 23/11/2026, valori qui per memoria):
--   payables f7b49085-a305-4239-bb97-2e1b0cef62e5
--     gross 250,00 | amount_paid 250,00 | amount_remaining 0,00
--     status pagato | payment_date 2026-01-02 | closed_manually false
--     payment_method carta_credito (MP08)
--     bank_transaction_id = cash_movement_id = 8d643100-...
--   bank_transactions 8d643100-2790-43c1-abd4-a395f314b2d9
--     06/03/2026 | -251,22 | is_reconciled true | reconciled_invoice_id f7b49085-...
--   reconciliation_log
--     7dc268e3-136a-4d1a-b7d7-494d1db5f00b rejected  (annullato il 19/11)
--     c2c8d862-cab3-4e82-b726-d26910392b49 applied   (rifatto il 20/11: questo si chiude)
--
-- `cash_movement_id` si azzera insieme a `bank_transaction_id`: nelle 2.126
-- righe di payables quella colonna è sempre uguale a `bank_transaction_id`
-- (927 su 927 valorizzate) e non esiste nessun caso con la cassa senza il
-- movimento. Lasciarla piena creerebbe l'unico caso al mondo, come è successo
-- fra il 19 e il 20 novembre.
-- =====================================================================

BEGIN;

-- 1. La fattura torna senza movimento agganciato. Stato, importi e data di
--    pagamento NON si toccano.
UPDATE public.payables
   SET bank_transaction_id = NULL,
       cash_movement_id = NULL,
       updated_at = now()
 WHERE id = 'f7b49085-a305-4239-bb97-2e1b0cef62e5'
   AND bank_transaction_id = '8d643100-2790-43c1-abd4-a395f314b2d9';

-- 2. La riga di log del 20/11 si chiude, con il perché scritto dentro.
UPDATE public.reconciliation_log
   SET status = 'rejected',
       notes = COALESCE(notes, '')
         || ' | 23/11/2026: rifatto dal motore il 20/11 alle 05:45, il giorno dopo che Patrizio l''aveva annullato, e annullato di nuovo. La causale dice «A FAVORE GLOBAL BLUE ITALIA SRL»: la conferma del fornitore arrivava dalla sola parola «FIRENZE», che è la città sul documento tax free. Vedi le migration 443 (le coppie escluse non tornano) e 444 (il beneficiario in causale deve essere il fornitore).'
 WHERE payable_id = 'f7b49085-a305-4239-bb97-2e1b0cef62e5'
   AND bank_transaction_id = '8d643100-2790-43c1-abd4-a395f314b2d9'
   AND status = 'applied';
-- Si cerca per coppia e stato, non per id della riga: di righe `applied` per
-- quella coppia ce n'è una sola (c2c8d862-cab3-...), e scrivere l'id a mano è
-- il modo più facile per sbagliare un carattere e aggiornare zero righe senza
-- che nessuno se ne accorga.

-- 3. Il movimento torna libero, così lo si può agganciare a quello che è
--    davvero: il rimborso tax free.
UPDATE public.bank_transactions
   SET is_reconciled = false,
       reconciled_at = NULL,
       reconciled_invoice_id = NULL
 WHERE id = '8d643100-2790-43c1-abd4-a395f314b2d9'
   AND reconciled_invoice_id = 'f7b49085-a305-4239-bb97-2e1b0cef62e5';

-- 4. La coppia entra nell'elenco delle escluse: il motore non la rifà più.
SELECT public.escludi_coppia(
  '8d643100-2790-43c1-abd4-a395f314b2d9',
  'f7b49085-a305-4239-bb97-2e1b0cef62e5',
  'Deciso da Patrizio il 19/11/2026: l''addebito del 06/03/2026 da 251,22 è un rimborso tax free Global Blue, non la fattura UNICOOP Firenze 044/000009, che è stata pagata con la carta BCC *3145 il 02/01/2026. Il motore l''aveva rifatto il 20/11; staccato di nuovo il 23/11.'
);

COMMIT;

-- =====================================================================
-- Verifica (solo NZ)
-- =====================================================================
--   SELECT bank_transaction_id, cash_movement_id, status, payment_date, amount_paid, amount_remaining
--     FROM public.payables WHERE id = 'f7b49085-a305-4239-bb97-2e1b0cef62e5';
--   -- attesi: NULL, NULL, pagato, 2026-01-02, 250.00, 0.00
--
--   SELECT is_reconciled, reconciled_invoice_id FROM public.bank_transactions
--    WHERE id = '8d643100-2790-43c1-abd4-a395f314b2d9';
--   -- attesi: false, NULL
--
--   SELECT status FROM public.reconciliation_log WHERE payable_id = 'f7b49085-a305-4239-bb97-2e1b0cef62e5';
--   -- attesi: due righe, tutte e due rejected
--
--   SELECT public.coppia_esclusa('8d643100-2790-43c1-abd4-a395f314b2d9',
--                                'f7b49085-a305-4239-bb97-2e1b0cef62e5');
--   -- atteso: true
-- =====================================================================
