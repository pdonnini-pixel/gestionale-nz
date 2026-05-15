-- Migrazione 037 — Aggiunge FK mancante bank_transactions.bank_account_id → bank_accounts.id
-- La colonna esisteva da tempo ma senza FK constraint → PostgREST schema cache non risolveva
-- la join con bank_accounts → errore "Could not find a relationship" in Prima Nota e altrove.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'bank_transactions_bank_account_id_fkey'
  ) THEN
    ALTER TABLE public.bank_transactions
      ADD CONSTRAINT bank_transactions_bank_account_id_fkey
      FOREIGN KEY (bank_account_id)
      REFERENCES public.bank_accounts(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bank_tx_account_id ON public.bank_transactions(bank_account_id);

-- Notifica PostgREST per refresh schema cache (riconosce subito la nuova FK)
NOTIFY pgrst, 'reload schema';
