-- Rollback della 333: torna a scrivere una riga per ogni proposta, anche ripetuta.
DROP TRIGGER IF EXISTS trg_reclog_skip_duplicate_proposal ON public.reconciliation_log;
DROP FUNCTION IF EXISTS public.reclog_skip_duplicate_proposal();
