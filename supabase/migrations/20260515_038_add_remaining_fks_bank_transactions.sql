-- Migrazione 038 — Aggiunge le altre 5 FK mancanti su bank_transactions
-- supplier_id, invoice_id, company_id, reconciled_invoice_id, import_id
-- Senza queste, PostgREST non risolve le join con .select(`..., suppliers(...)`) ecc
-- → errore "Could not find a relationship" in Prima Nota e altre pagine.
-- Verificato 0 orfani su tutte prima di aggiungere.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'bank_transactions_supplier_id_fkey') THEN
    ALTER TABLE public.bank_transactions
      ADD CONSTRAINT bank_transactions_supplier_id_fkey
      FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'bank_transactions_invoice_id_fkey') THEN
    ALTER TABLE public.bank_transactions
      ADD CONSTRAINT bank_transactions_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES public.payables(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'bank_transactions_company_id_fkey') THEN
    ALTER TABLE public.bank_transactions
      ADD CONSTRAINT bank_transactions_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'bank_transactions_reconciled_invoice_id_fkey') THEN
    ALTER TABLE public.bank_transactions
      ADD CONSTRAINT bank_transactions_reconciled_invoice_id_fkey
      FOREIGN KEY (reconciled_invoice_id) REFERENCES public.payables(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'bank_transactions_import_id_fkey') THEN
    ALTER TABLE public.bank_transactions
      ADD CONSTRAINT bank_transactions_import_id_fkey
      FOREIGN KEY (import_id) REFERENCES public.import_batches(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bank_tx_supplier_id ON public.bank_transactions(supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bank_tx_invoice_id ON public.bank_transactions(invoice_id) WHERE invoice_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
