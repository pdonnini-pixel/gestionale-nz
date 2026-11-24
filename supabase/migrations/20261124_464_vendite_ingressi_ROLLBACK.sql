-- Rollback della migrazione 464 «Vendite e ingressi».
-- ATTENZIONE: togliere le colonne cancella pezzi, valore teorico e costo
-- d'acquisto caricati dai report MODA. Prima di eseguirlo fare un backup:
--   CREATE TABLE public._bkp_464_traffico AS
--     SELECT id, pezzi, valore_teorico, costo_acquisto FROM public.outlet_traffic_hourly
--      WHERE valore_teorico IS NOT NULL;
--   CREATE TABLE public._bkp_464_codici AS SELECT * FROM public.outlet_moda_codici;
-- e avere la conferma di Patrizio (regola NO DATA LOSS).
BEGIN;
DROP FUNCTION IF EXISTS public.vendite_ingressi_report(date);
DROP TABLE IF EXISTS public.outlet_moda_codici;
ALTER TABLE public.outlet_traffic_hourly
  DROP COLUMN IF EXISTS pezzi,
  DROP COLUMN IF EXISTS valore_teorico,
  DROP COLUMN IF EXISTS costo_acquisto;
COMMIT;
