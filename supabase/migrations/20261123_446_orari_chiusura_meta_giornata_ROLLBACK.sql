-- ROLLBACK 446 — toglie la chiusura di metà giornata.
-- ATTENZIONE: cancella gli orari spezzati scritti dopo la 446 (Forte dei Marmi).
-- Prima di eseguirlo salvare: SELECT outlet_id, giorno, chiusura_dalle, chiusura_alle FROM outlet_opening_hours WHERE chiusura_dalle IS NOT NULL;
BEGIN;
ALTER TABLE public.outlet_opening_hours DROP CONSTRAINT IF EXISTS outlet_opening_hours_chiusura_ok;
ALTER TABLE public.outlet_special_days DROP CONSTRAINT IF EXISTS outlet_special_days_chiusura_ok;
ALTER TABLE public.outlet_opening_hours DROP COLUMN IF EXISTS chiusura_dalle, DROP COLUMN IF EXISTS chiusura_alle;
ALTER TABLE public.outlet_special_days DROP COLUMN IF EXISTS chiusura_dalle, DROP COLUMN IF EXISTS chiusura_alle;
COMMIT;
