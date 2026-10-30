-- Rollback della 331: toglie la colonna (solo se si e' sicuri di non perdere scelte salvate).
ALTER TABLE public.outlet_shift_rules DROP COLUMN IF EXISTS due_persone;
