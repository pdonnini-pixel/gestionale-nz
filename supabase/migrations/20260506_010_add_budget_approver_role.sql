-- @no-transaction
-- ============================================================================
-- 20260506_010_add_budget_approver_role.sql
--
-- Aggiunge il valore 'budget_approver' all'enum public.user_role.
-- Necessario per Lilian (role budget_approver) che il provisioning crea su
-- ogni nuovo tenant. Senza questo, INSERT INTO user_profiles(role) per
-- Lilian fallirebbe con `invalid input value for enum user_role`.
--
-- Nota tecnica: ALTER TYPE ... ADD VALUE NON può essere eseguito dentro una
-- transazione esplicita (limite PostgreSQL). Per questo il file ha la flag
-- `-- @no-transaction` in cima — apply-migrations.ts la rispetta e applica
-- lo statement in autocommit.
--
-- IF NOT EXISTS rende l'operazione idempotente.
-- Su NZ è additivo, sicuro: dati esistenti continuano a usare i valori
-- precedenti (super_advisor, cfo, coo, ceo, contabile).
-- ============================================================================

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'budget_approver';
