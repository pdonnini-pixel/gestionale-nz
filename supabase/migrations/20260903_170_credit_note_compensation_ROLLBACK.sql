-- ROLLBACK di 20260903_170_credit_note_compensation.sql
-- Ripristina le versioni precedenti delle funzioni (migration 150 reopen_payable,
-- 090 apply_credit_note_links / undo_reconcile_movement, 109 close_payable_manually,
-- 147 rpc_link_riba_credit_note) rieseguendo quei file, e rimuove la RPC nuova e
-- l'helper. La colonna origin NON viene droppata (NO DATA LOSS): resta inerte.
--
-- Ordine consigliato:
--   1. DROP delle funzioni nuove (sotto)
--   2. \i 20260808_150_reopen_payable_rpc.sql
--   3. \i 20260713_090_credit_note_links_reconcile.sql   (solo le sezioni 2 e 4:
--      apply_credit_note_links e undo_reconcile_movement)
--   4. \i 20260719_109_close_payable_manually_rpc.sql
--   5. \i 20260806_147_riba_credit_note_manual_link.sql (solo rpc_link_riba_credit_note)
--   6. \i 20260902_154_lockdown_anon_definer_functions.sql (riafferma i REVOKE anon)
--
-- ATTENZIONE: le versioni precedenti NON conoscono il residuo parziale. Le NC
-- compensate parzialmente dopo la 170 (amount_paid negativo, non chiuse) restano
-- comunque coerenti: Scadenzario e Fornitori leggono amount_remaining.

BEGIN;
DROP FUNCTION IF EXISTS public.compensate_payable_with_credit_note(uuid, uuid, numeric, date, text, text);
DROP FUNCTION IF EXISTS public.credit_note_residual(numeric, numeric, boolean, date);
COMMIT;
