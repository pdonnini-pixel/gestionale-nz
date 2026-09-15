-- =====================================================================
-- 224 — Movimenti delle carte (estratti conto carta riga per riga)
-- =====================================================================
-- Richiesta di Patrizio (15/09/2026): nella Prima Nota «uno sheet per
-- carta: prendi gli estratti conto delle carte del mese e fai come per le
-- banche». Gli estratti carta (CartaBCC/Numia, Carta Montepaschi, prepagata
-- Tasca) erano gia' catalogati in bank_statements (doc_kind = 'carta') e
-- archiviati nel bucket bank-statements, ma solo come file: nessuna riga
-- leggibile, quindi nessun foglio, nessuna quadratura con l'addebito in
-- banca e nessun aggancio alle fatture pagate con carta.
--
-- COSA INTRODUCE:
--   * card_transactions: una riga per operazione dell'estratto carta,
--     legata al suo bank_statements (statement_id). Importo con il segno
--     di un conto: spesa negativa, ricarica/storno positiva; commissione
--     a parte (fee). payable_id quando la riga paga una fattura dello
--     Scadenzario (stesso importo, stessa finestra di date).
--   * bank_statements.card_last4: ultime 4 cifre della carta lette dal
--     documento (non dal nome del file).
--   * bank_statements.statement_total: totale dichiarato dall'estratto
--     (TOTALE OPERAZIONI / TOTALE SPESE / Totale Movimenti), stesso segno.
--   * bank_statements.settled_bank_transaction_id: l'addebito in banca che
--     salda l'estratto (carte di credito), trovato per importo.
-- Additiva: nessuna tabella esistente perde colonne o righe.
-- REGOLA #0: NZ -> Made -> Zago.
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.card_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id),
  statement_id     uuid NOT NULL REFERENCES public.bank_statements(id) ON DELETE CASCADE,
  row_no           integer NOT NULL,
  card_last4       text,
  purchase_date    date NOT NULL,
  posting_date     date,
  description      text NOT NULL DEFAULT '',
  -- Segno come su un conto: spesa negativa, ricarica/storno/rimborso positiva.
  amount           numeric(12,2) NOT NULL,
  fee              numeric(12,2) NOT NULL DEFAULT 0,
  currency         text NOT NULL DEFAULT 'EUR',
  original_amount  numeric(12,2),
  payable_id       uuid REFERENCES public.payables(id) ON DELETE SET NULL,
  note             text,
  raw              jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  UNIQUE (statement_id, row_no)
);
COMMENT ON TABLE public.card_transactions IS 'Righe degli estratti conto carta (bank_statements.doc_kind = carta): una per operazione, importo con il segno di un conto (spesa negativa).';
COMMENT ON COLUMN public.card_transactions.amount IS 'Importo in euro con il segno di un conto: spesa negativa, ricarica/storno positiva.';
COMMENT ON COLUMN public.card_transactions.fee IS 'Commissione dell''operazione (negativa), a parte dall''importo.';
COMMENT ON COLUMN public.card_transactions.payable_id IS 'Fattura dello Scadenzario pagata da questa riga (abbinata per importo e data all''import, o a mano).';

CREATE INDEX IF NOT EXISTS card_transactions_company_date_idx ON public.card_transactions (company_id, purchase_date);
CREATE INDEX IF NOT EXISTS card_transactions_statement_idx ON public.card_transactions (statement_id);
CREATE INDEX IF NOT EXISTS card_transactions_payable_idx ON public.card_transactions (payable_id) WHERE payable_id IS NOT NULL;

ALTER TABLE public.card_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS card_transactions_select ON public.card_transactions;
CREATE POLICY card_transactions_select ON public.card_transactions
  FOR SELECT USING (company_id = get_my_company_id());
DROP POLICY IF EXISTS card_transactions_insert ON public.card_transactions;
CREATE POLICY card_transactions_insert ON public.card_transactions
  FOR INSERT WITH CHECK (company_id = get_my_company_id());
DROP POLICY IF EXISTS card_transactions_update ON public.card_transactions;
CREATE POLICY card_transactions_update ON public.card_transactions
  FOR UPDATE USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
DROP POLICY IF EXISTS card_transactions_delete ON public.card_transactions;
CREATE POLICY card_transactions_delete ON public.card_transactions
  FOR DELETE USING (company_id = get_my_company_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_transactions TO authenticated;
GRANT ALL ON public.card_transactions TO service_role;

ALTER TABLE public.bank_statements
  ADD COLUMN IF NOT EXISTS card_last4 text,
  ADD COLUMN IF NOT EXISTS statement_total numeric(12,2),
  ADD COLUMN IF NOT EXISTS settled_bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.bank_statements.card_last4 IS 'Estratti carta: ultime 4 cifre della carta lette dal documento.';
COMMENT ON COLUMN public.bank_statements.statement_total IS 'Estratti carta: totale dichiarato dal documento, con il segno di un conto (spese negative).';
COMMENT ON COLUMN public.bank_statements.settled_bank_transaction_id IS 'Estratti carta di credito: movimento bancario che addebita l''estratto.';

COMMIT;
