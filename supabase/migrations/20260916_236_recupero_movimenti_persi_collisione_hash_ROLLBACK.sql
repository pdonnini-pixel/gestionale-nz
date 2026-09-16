-- ROLLBACK di 20260916_236_recupero_movimenti_persi_collisione_hash.sql
-- Toglie solo le righe reinserite da quella migration, riconoscibili dalla nota.
BEGIN;
DELETE FROM public.bank_transactions
 WHERE note LIKE 'recuperato il 16/09/2026 da acube_transactions%';
COMMIT;
