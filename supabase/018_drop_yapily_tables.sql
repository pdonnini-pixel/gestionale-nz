-- Migrazione 018: Cleanup Yapily — DROP tabelle inutilizzate
-- Data: 2026-06-01
-- Contesto: integrazione Yapily dismessa (sostituita da Acube Open Banking).
--   Le 3 tabelle yapily_* erano a 0 righe su tutti e 3 i tenant (NZ/Made/Zago)
--   e l'unico punto live nel frontend (yapily-sync-all) e' gia' stato rimosso (PR #117).
--   La colonna bank_transactions.account_id (FK -> yapily_accounts) era 100% NULL
--   (0 valori su 753 righe NZ), quindi la rimozione della FK non perde dati.
-- NOTA: la COLONNA bank_transactions.account_id NON viene droppata (resta NULL, innocua).
--   Le edge function yapily-* restano deployate ma morte (nessun chiamante).
-- Applicata via MCP apply_migration su: NZ xfvfxsvqpnpvibgeqpqp / Made wdgoebzvosspjqttitra / Zago jxlwvzjreukscnswkbjx
-- Rollback: vedi supabase/ROLLBACK_yapily_drop_20260601.sql

BEGIN;

-- 1. Rimuovi la FK in entrata da bank_transactions (account_id 100% NULL)
ALTER TABLE bank_transactions DROP CONSTRAINT IF EXISTS bank_transactions_account_id_fkey;

-- 2. Drop tabelle in ordine di dipendenza (payments -> accounts -> consents)
DROP TABLE IF EXISTS yapily_payments;
DROP TABLE IF EXISTS yapily_accounts;
DROP TABLE IF EXISTS yapily_consents;

COMMIT;
