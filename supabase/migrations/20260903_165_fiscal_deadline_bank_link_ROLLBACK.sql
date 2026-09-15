-- ROLLBACK di 20260903_165_fiscal_deadline_bank_link.sql
--
-- ATTENZIONE: la colonna bank_transaction_id NON viene rimossa. Contiene gli agganci
-- fra scadenze fiscali e movimenti bancari, che sono dato reale (regola NO DATA LOSS).
-- Vengono rimosse solo le due funzioni. Se serve davvero eliminare la colonna, farlo
-- a mano dopo un backup esplicito e la conferma di Patrizio:
--   ALTER TABLE public.fiscal_deadlines DROP COLUMN bank_transaction_id;

BEGIN;

DROP FUNCTION IF EXISTS public.undo_reconcile_fiscal_deadline(uuid);
DROP FUNCTION IF EXISTS public.reconcile_fiscal_deadline(uuid, uuid);

COMMIT;
