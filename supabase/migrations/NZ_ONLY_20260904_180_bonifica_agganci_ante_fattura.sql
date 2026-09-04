-- =============================================================================
-- NZ_ONLY 180 — Bonifica dei 33 agganci con movimento antecedente alla fattura
-- =============================================================================
-- Segue la migration 179 (guardia "non si paga una fattura che non esiste ancora").
-- La 179 corregge il motore; questa rimette a posto i dati che il motore aveva già
-- sbagliato. Eseguita il 04/09/2026 su NZ con conferma esplicita di Patrizio.
--
-- SOLO NZ: su Made e Zago la tabella payables è vuota, non c'è niente da bonificare
-- (verificato: 0 agganci ante-fattura su entrambi).
--
-- COSA COMPRENDEVA IL PERIMETRO
--   45 scadenze avevano un movimento bancario anteriore alla propria invoice_date.
--   Di queste sono state toccate solo le 33 automatiche con anticipo >= 4 giorni
--   (13.183,41 €). Restano intatte:
--     * 7 righe automatiche con 1-3 giorni di anticipo, plausibili (bonifico disposto
--       il giorno prima della data documento: Torino Fashion Village, Boschetti, ...)
--     * 5 chiusure manuali / go-live, che sono decisioni umane.
--
-- NOTA SULLA NUMERAZIONE
--   La tabella di backup si chiama backup_176_... e le note scritte nel
--   reconciliation_log citano "migr. 176": sono state create quando la guardia
--   portava quel numero, prima che su main comparisse un'altra 176 (bridge
--   ritenuta d'acconto). I file sono stati rinumerati 179/180/181, i nomi già
--   scritti nel database no: riscriverli avrebbe solo aggiunto rumore.
--
-- BACKUP
--   Tabella public.backup_176_agganci_ante_fattura: una riga per aggancio annullato,
--   con to_jsonb(payables.*) e to_jsonb(bank_transactions.*) PRIMA della modifica,
--   più il log_id. È la sorgente del rollback. NON cancellarla.
--
-- 1) SGANCIO (33 righe)
--   a. 12 scadenze che il MOTORE aveva dichiarato pagate con quel movimento:
--      amount_paid = 0, payment_date = NULL, bank_transaction_id = NULL.
--      Tornano da pagare. Fra queste EPPI 32, scadenza 30/09/2026: non era pagata,
--      il gestionale la dava per saldata da un bonifico di giugno.
--   b. 21 scadenze GIÀ pagate prima dell'aggancio (chiusura a mano o go-live):
--      azzerato solo bank_transaction_id. Restano pagate, cambia il collegamento.
--   c. i 33 movimenti tornano fra i "da riconciliare" (is_reconciled = false).
--   d. i log passano a 'rejected' con nota: niente viene cancellato.
--
-- 2) RICERCA DEL MOVIMENTO REALE
--   Per ognuna delle 33, ricerca sugli estratti conto di un movimento con importo
--   compatibile (o netto CBI, al lordo delle commissioni), data >= invoice_date e
--   <= due_date + 180, non già assegnato ad altra scadenza. Sono stati agganciati
--   solo gli abbinamenti UNIVOCI in entrambe le direzioni (una sola fattura per quel
--   movimento e un solo movimento per quella fattura): 6 righe, 1.883,21 €.
--
--   Regola applicata su richiesta di Patrizio: quando arriva il movimento reale,
--   la riconciliazione bancaria SOVRASCRIVE la chiusura a mano o da go-live.
--   Quindi su queste 6: closed_manually = false e payment_date = data del movimento,
--   che è la data vera dell'uscita di cassa.
--
--   Le coppie agganciate:
--     CONSORZIO SHOPINN 26-0336   1.385,05  -> SDD 15/06/2026 a favore SHOPINN
--     LA SCOPA MAGICA FPR 399/26    370,00  -> bonifico 13/07/2026
--     COSIMO DE MEDICI 1595/2026     39,50  -> bonifico 11/03/2026 "SALDO FATTURA"
--     COSIMO DE MEDICI 2851/2026     41,50  -> bonifico 30/04/2026 "SALDO FATTURA"
--     ENEL 005454195305              23,58  -> SDD 27/07/2026 (data = scadenza)
--     ENEL 005433280024              23,58  -> SDD 24/06/2026 (unico rimasto)
--
-- 3) ESITO
--     6 righe riagganciate al movimento vero            1.883,21 €
--    16 restano pagate, senza movimento collegato       7.610,27 €
--    11 tornate da pagare, nessun movimento trovato     3.689,93 €
--
--   Le 11 da pagare sono 7 commissioni Nexi da 25,62 (11 fatture uguali contro 7
--   addebiti uguali: il motore non può assegnarle, serve l'occhio di Sabrina),
--   Unicoop 400,00, Palmanova 23,99, Remas 36,60 ed EPPI 32 da 3.050,00.
-- =============================================================================

-- Questo file documenta operazioni già eseguite via MCP il 04/09/2026.
-- Riportato qui per lasciare traccia versionata, come da CLAUDE.md.
-- Rieseguirlo è inutile ma non dannoso: gli UPDATE sono idempotenti sul perimetro
-- del backup, che è congelato.

-- --- 1) sgancio -------------------------------------------------------------
-- a. dichiarate pagate dal motore: tornano aperte
UPDATE public.payables p
SET amount_paid = 0, payment_date = NULL, bank_transaction_id = NULL, updated_at = now()
FROM public.backup_176_agganci_ante_fattura b
WHERE p.id = (b.payable_prima->>'id')::uuid
  AND NOT (b.note ILIKE '%già pagata%' OR b.note ILIKE '%chiusa a mano%')
  AND p.bank_transaction_id = (b.movimento_prima->>'id')::uuid;

-- b. già pagate prima: salta solo il collegamento
UPDATE public.payables p
SET bank_transaction_id = NULL, updated_at = now()
FROM public.backup_176_agganci_ante_fattura b
WHERE p.id = (b.payable_prima->>'id')::uuid
  AND (b.note ILIKE '%già pagata%' OR b.note ILIKE '%chiusa a mano%')
  AND p.bank_transaction_id = (b.movimento_prima->>'id')::uuid;

-- c. i movimenti tornano da riconciliare
UPDATE public.bank_transactions bt
SET is_reconciled = false, reconciled_at = NULL, reconciled_invoice_id = NULL
FROM public.backup_176_agganci_ante_fattura b
WHERE bt.id = (b.movimento_prima->>'id')::uuid;

-- d. log annullato, non cancellato
UPDATE public.reconciliation_log rl
SET status = 'rejected',
    notes = COALESCE(rl.notes,'') || ' | annullato il 04/09/2026: movimento antecedente alla data fattura (migr. 176), backup in backup_176_agganci_ante_fattura'
FROM public.backup_176_agganci_ante_fattura b
WHERE rl.id = b.log_id AND rl.status = 'applied';

-- --- 2) riaggancio ai movimenti reali (6 coppie univoche) --------------------
-- Vedi elenco nel commento sopra. Gli id sono espliciti perché ogni coppia è stata
-- verificata a mano una per una sulla causale dell'estratto conto.
WITH coppie(payable_id, bt_id, motivo) AS (VALUES
  ('9561c823-200c-493b-bcc9-2babdae84cc9'::uuid,'e28e3772-719e-4d12-b4d7-2732ab81f046'::uuid,'SDD 15/06 a favore CONSORZIO SHOPINN, importo esatto 1.385,05, movimento unico'),
  ('478c3ecf-0f1d-4e60-a2c0-3de6fb31d414','f5c64ae3-1149-41e0-8138-c51b5637c7f6','bonifico 13/07 a LA SCOPA MAGICA, importo esatto 370,00, movimento unico'),
  ('49923486-ea9c-43c3-9019-7771108616a9','f883e7de-0400-4441-a80a-a0f3cc4fca98','bonifico 11/03 SALDO FATTURA COSIMO DEI MEDICI, importo esatto 39,50'),
  ('b47213d3-e59b-44e3-b0b3-5ea872097b8a','612a75ae-10b8-425c-bfd0-1c2fe8725f1d','bonifico 30/04 SALDO FATTURA COSIMO DEI MEDICI, importo esatto 41,50'),
  ('151e74a2-6e5c-4002-a805-04bcb664a33a','64fb8ed1-d779-4f65-b4db-8d099252ef2e','SDD 27/07 a favore ENEL, importo esatto e data = scadenza della bolletta'),
  ('54994265-8a6c-4573-a84a-9562d2c2a1f1','3ec82adb-5a71-482c-9f2a-971dde0649c1','SDD 24/06 a favore ENEL: unico addebito rimasto per la bolletta di maggio')
)
UPDATE public.payables p
SET bank_transaction_id = c.bt_id,
    amount_paid = p.gross_amount,
    payment_date = bt.transaction_date,
    closed_manually = false,
    updated_at = now()
FROM coppie c JOIN public.bank_transactions bt ON bt.id = c.bt_id
WHERE p.id = c.payable_id;

-- =============================================================================
-- VERIFICA
--   SELECT count(*) FROM payables p JOIN bank_transactions bt ON bt.id = p.bank_transaction_id
--   WHERE bt.transaction_date < p.invoice_date;
--   -> 13: le 8 righe a 1-3 giorni di anticipo e le 5 chiusure manuali, tutte volute.
-- =============================================================================
