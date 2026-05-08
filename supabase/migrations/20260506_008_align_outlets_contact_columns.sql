-- ============================================================================
-- 20260506_008_align_outlets_contact_columns.sql
--
-- Allinea lo schema `outlets` tra NZ e i tenant nuovi (Made, Zago).
-- BUG-D del fix bootstrap onboarding:
--   - Made/Zago hanno `cap`, `email`, `phone` (aggiunte come fix temp manuale
--     da Patrizio durante il primo test E2E del wizard).
--   - NZ NON le ha → drift.
-- Il wizard frontend invia queste 3 colonne in `INSERT INTO outlets`. Su NZ
-- fallirebbe con `PGRST204 Could not find the 'cap' column`.
--
-- Fix: ALTER TABLE additivo, idempotente. Su Made/Zago è no-op.
-- ============================================================================

ALTER TABLE public.outlets ADD COLUMN IF NOT EXISTS cap text;
ALTER TABLE public.outlets ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.outlets ADD COLUMN IF NOT EXISTS email text;

COMMENT ON COLUMN public.outlets.cap IS 'CAP indirizzo outlet (introdotto 2026-05 con multi-tenant onboarding)';
COMMENT ON COLUMN public.outlets.phone IS 'Telefono outlet';
COMMENT ON COLUMN public.outlets.email IS 'Email outlet';
