-- ROLLBACK migrazione 150 — rimuove la RPC di riapertura scadenza.
-- Additiva: il rollback si limita a droppare la funzione. Le righe gia'
-- riaperte restano tali (nessun dato distrutto).
DROP FUNCTION IF EXISTS public.reopen_payable(uuid, text, text);
