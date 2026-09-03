-- ROLLBACK di 20260903_167_close_incoming_movements.sql
--
-- Rimuove solo la funzione. Se la chiusura per natura era gia' stata ESEGUITA
-- (close_incoming_movements(false)), i movimenti restano marcati: per riaprirli
-- serve un intervento mirato, che riconosce le righe dalla nota lasciata.
--   UPDATE public.bank_transactions
--   SET is_reconciled = false, reconciled_at = NULL, category = NULL,
--       note = nullif(regexp_replace(note, '\s*\|?\s*chiuso automaticamente \(entrata: [a-z_]+\)', ''), '')
--   WHERE note LIKE '%chiuso automaticamente (entrata:%';
-- Da eseguire solo su richiesta esplicita: e' comunque una modifica di massa.

BEGIN;
DROP FUNCTION IF EXISTS public.close_incoming_movements(boolean);
COMMIT;
