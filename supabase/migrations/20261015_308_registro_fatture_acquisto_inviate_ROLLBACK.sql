-- Rollback migrazione 308 — registro delle fatture acquisto consegnate allo studio.
-- ATTENZIONE: cancella il registro. Prima di eseguirlo salvare le righe:
--   SELECT * FROM public.purchase_invoice_dispatches;
-- e avere la conferma di Patrizio (regola NO DATA LOSS).

DROP TABLE IF EXISTS public.purchase_invoice_dispatches;
