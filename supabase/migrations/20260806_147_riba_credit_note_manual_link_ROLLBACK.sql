-- ============================================================================
-- ROLLBACK 20260806_147_riba_credit_note_manual_link.sql
-- Rimuove gli RPC di abbinamento/annullamento NC RiBa. NON riapre le note di
-- credito gia' abbinate (usare rpc_unlink_riba_credit_note prima, oppure lo
-- statement commentato in fondo). Non tocca payable_credit_note_links (condivisa).
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_link_riba_credit_note(uuid, uuid);
DROP FUNCTION IF EXISTS public.rpc_unlink_riba_credit_note(uuid);

COMMIT;

-- Per riaprire le NC abbinate da questa funzione (se serve):
-- UPDATE public.payables p SET closed_manually = false, payment_date = NULL, manual_close_reason = NULL
-- WHERE (p.status = 'nota_credito' OR p.gross_amount < 0)
--   AND p.manual_close_reason LIKE 'Abbinata a scadenza RiBa %';
-- UPDATE public.payable_credit_note_links SET status = 'cancelled'
-- WHERE status = 'applied' AND credit_note_payable_id IN (
--   SELECT id FROM public.payables WHERE manual_close_reason LIKE 'Abbinata a scadenza RiBa %');
