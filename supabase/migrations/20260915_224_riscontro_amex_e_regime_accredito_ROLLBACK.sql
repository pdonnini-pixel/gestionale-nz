-- Rollback della 224: toglie la colonna del regime. La funzione va
-- ripristinata riapplicando la 20260907_200 (ultima versione precedente).
ALTER TABLE public.outlet_payment_channels DROP COLUMN IF EXISTS settlement_mode;
