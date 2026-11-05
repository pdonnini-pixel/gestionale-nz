-- ROLLBACK 360 — toglie la chiusura automatica delle proposte di abbinamento.
-- Le proposte chiuse dalla pulizia restano `rejected`; per riaprirle, solo se serve:
--   UPDATE public.reconciliation_log SET status = 'to_confirm'
--    WHERE status IN ('rejected','superseded') AND notes LIKE '%(pulizia 360)%';  -- dopo la 361 sono 'superseded'
DROP TRIGGER IF EXISTS trg_close_proposals_on_bt_reconciled ON public.bank_transactions;
DROP TRIGGER IF EXISTS trg_close_proposals_on_payable_closed ON public.payables;
DROP FUNCTION IF EXISTS public.fn_close_proposals_on_bt_reconciled();
DROP FUNCTION IF EXISTS public.fn_close_proposals_on_payable_closed();
DROP FUNCTION IF EXISTS public.payable_closed_for_proposals(text, boolean, uuid);
