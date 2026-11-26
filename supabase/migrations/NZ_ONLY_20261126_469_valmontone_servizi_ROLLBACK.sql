-- ROLLBACK NZ_ONLY 469: toglie solo le righe scritte dalla 469 (se nel frattempo sono state cambiate a mano, fare prima un SELECT di backup).
BEGIN;
DELETE FROM public.outlet_servizi
 WHERE outlet_id = '8dcb3b9f-c5ba-4213-93ac-839adcbafd03'
   AND (tipo, giorno) IN (('scarico', 2), ('pulizie', 1), ('pulizie', 5));
DELETE FROM public.outlet_consegne
 WHERE outlet_id = '8dcb3b9f-c5ba-4213-93ac-839adcbafd03' AND data = DATE '2026-12-08';
COMMIT;
