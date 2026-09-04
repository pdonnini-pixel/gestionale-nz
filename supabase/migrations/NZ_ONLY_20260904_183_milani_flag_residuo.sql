-- =============================================================================
-- NZ_ONLY — MILANI 26/A: spento il flag di chiusura a mano rimasto acceso
-- Applicato su NZ il 04/09/2026 via MCP. Solo UPDATE. Backup in
-- public._bkp_milani26a_20260904.
-- =============================================================================
--
-- Coda del fix 182. La verifica «nessuna riga aperta col flag di chiusura
-- acceso» tornava 1 invece di 0: MILANI S.P.A. 26/A del 12/05/2026, 1.220,00,
-- stato scaduto, amount_paid 0, closed_manually true, ultimo tocco il
-- 01/08/2026.
--
-- Non si vede e non pesa su nessun numero: e' un'autofattura reverse charge,
-- gia' nascosta dallo Scadenzario con is_placeholder = true. Il trigger nuovo
-- lo avrebbe spento al primo UPDATE, ma cosi' l'invariante torna vera subito e
-- le verifiche future partono da zero.
--
-- Si tocca solo il flag: stato, importi e is_placeholder restano come sono.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public._bkp_milani26a_20260904 AS
SELECT * FROM public.payables WHERE id = '1842c1e3-07e6-4748-acb2-9f5c41bc0660';

ALTER TABLE public._bkp_milani26a_20260904 ENABLE ROW LEVEL SECURITY;

UPDATE public.payables
   SET closed_manually = false,
       manual_close_reason = NULL,
       notes = coalesce(nullif(notes,''),'') || CASE WHEN coalesce(notes,'') <> '' THEN ' | ' ELSE '' END
               || 'Flag «chiusa a mano» spento il 04/09/2026: la riga e'' aperta e senza pagato, il flag era un residuo. Riga comunque nascosta (autofattura reverse charge).'
 WHERE id = '1842c1e3-07e6-4748-acb2-9f5c41bc0660'
   AND coalesce(closed_manually,false) = true
   AND coalesce(amount_paid,0) = 0;

COMMIT;

-- VERIFICA
-- select count(*) from payables
--  where coalesce(closed_manually,false) and coalesce(amount_paid,0)=0 and bank_transaction_id is null
--    and status::text not in ('pagato','parziale','nota_credito','annullato');
-- atteso: 0
