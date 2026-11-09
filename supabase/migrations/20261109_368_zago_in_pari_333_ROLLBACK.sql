-- Rollback della 368 (su Zago): via il trigger e la funzione della guardia 333.
-- Dopo questo, le proposte to_confirm ripetute tornano a scrivere una riga a testa.
DROP TRIGGER IF EXISTS trg_reclog_skip_duplicate_proposal ON public.reconciliation_log;
DROP FUNCTION IF EXISTS public.reclog_skip_duplicate_proposal();
