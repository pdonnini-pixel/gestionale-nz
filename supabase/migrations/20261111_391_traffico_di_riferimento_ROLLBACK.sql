-- Rollback della 391: toglie la colonna del traffico di riferimento.
-- Perde solo la scelta del negozio di riferimento (nessun altro dato).
BEGIN;
ALTER TABLE public.outlet_shift_rules DROP COLUMN IF EXISTS traffico_da_outlet_id;
COMMIT;
