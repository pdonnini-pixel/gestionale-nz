-- Rollback migrazione 306 — torna al riparto per fornitore (vista della 297)
--
-- 1. Toglie il job notturno.
-- 2. Rieseguire per intero la 20261012_297_costi_outlet_spese_cassa_commissioni.sql
--    (ricrea v_costi_outlet_da_fatture con invoice_cost_overrides).
-- 3. Poi questo file: la vista v_negozio_fattura e le funzioni non servono più.
--    La tabella invoice_outlet_auto contiene solo dati calcolati dal documento
--    (si ricostruiscono con fn_negozio_per_fattura_tutte(true)): la si lascia, vuota
--    di effetti, oppure la si elimina con conferma di Patrizio.
--
-- Prima di eseguire: riportare la Prima Nota a leggere invoice_cost_overrides
-- (src/pages/PrimaNota.tsx), altrimenti la colonna Negozio resta vuota.

SELECT cron.unschedule('negozio-per-fattura-notturno');
SELECT cron.unschedule('negozio-per-fattura-settimanale');

-- (qui rieseguire la 297)

DROP VIEW IF EXISTS public.v_negozio_fattura;
DROP FUNCTION IF EXISTS public.fn_negozio_per_fattura_tutte(boolean);
DROP FUNCTION IF EXISTS public.fn_negozio_per_fattura(uuid, boolean, int);
DROP FUNCTION IF EXISTS public.fn_negozio_per_fattura_calcolo(uuid, boolean, int);
