-- Migration 046: dedup hard su import CSV per bank_transactions
--
-- Bug: TesoreriaManuale.handleImport inseriva i bank_transactions senza
-- alcun controllo. Reimportare lo stesso CSV (anche solo parzialmente
-- sovrapposto) raddoppiava i movimenti. Su NZ erano gia' 215 le righe
-- duplicate residue (cleanup eseguito prima di questa migration).
--
-- Soluzione: colonna import_dedup_hash + trigger che la calcola
-- automaticamente + UNIQUE INDEX parziale.
--
-- L'hash NON viene popolato per le righe da A-Cube OB (source LIKE 'api_acube%'),
-- che hanno gia' il proprio acube_dedup_hash con index unique dedicato.
--
-- IMPORTANTE: prima di applicare questa migration su un tenant con dati
-- esistenti, eseguire cleanup duplicati (vedi tabella backup
-- _backup_bank_tx_dedup_<data> creata su NZ il 2026-05-26).

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS import_dedup_hash TEXT;

CREATE OR REPLACE FUNCTION public.compute_bank_tx_dedup_hash(
  p_bank_account_id UUID,
  p_transaction_date DATE,
  p_amount NUMERIC,
  p_description TEXT
) RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT md5(
    coalesce(p_bank_account_id::text, '')
    || '|' || coalesce(p_transaction_date::text, '')
    || '|' || coalesce(to_char(p_amount, 'FM999999999999999990.00'), '')
    || '|' || lower(trim(coalesce(p_description, '')))
  );
$$;

CREATE OR REPLACE FUNCTION public.trg_set_bank_tx_dedup_hash() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source IS NULL OR NEW.source NOT LIKE 'api_acube%' THEN
    NEW.import_dedup_hash := public.compute_bank_tx_dedup_hash(
      NEW.bank_account_id, NEW.transaction_date, NEW.amount, NEW.description
    );
  ELSE
    NEW.import_dedup_hash := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_bank_tx_dedup_hash ON public.bank_transactions;
CREATE TRIGGER set_bank_tx_dedup_hash
  BEFORE INSERT OR UPDATE OF bank_account_id, transaction_date, amount, description, source
  ON public.bank_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_set_bank_tx_dedup_hash();

UPDATE public.bank_transactions
SET import_dedup_hash = public.compute_bank_tx_dedup_hash(
  bank_account_id, transaction_date, amount, description
)
WHERE import_dedup_hash IS NULL
  AND (source IS NULL OR source NOT LIKE 'api_acube%');

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_tx_import_dedup
  ON public.bank_transactions (company_id, import_dedup_hash)
  WHERE import_dedup_hash IS NOT NULL;

COMMENT ON COLUMN public.bank_transactions.import_dedup_hash IS
  'MD5 di bank_account_id|date|amount|description per dedup hard su import CSV. NULL per righe da A-Cube OB (vedi acube_dedup_hash).';
COMMENT ON INDEX public.idx_bank_tx_import_dedup IS
  'Vincolo unique che previene il raddoppio di movimenti su reimport CSV.';
