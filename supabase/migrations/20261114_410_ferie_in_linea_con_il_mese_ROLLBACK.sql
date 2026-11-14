-- ROLLBACK della 410: toglie le proposte di ferie del piano del mese.
-- ATTENZIONE (NO DATA LOSS): le richieste nate da una proposta e GIA' APPROVATE restano richieste
-- vere e non si toccano; cambia solo la loro origine, che torna 'gestionale' (il vincolo di prima
-- non ammette 'piano_mese'), e il legame con il piano va perso con la colonna. Per questo prima
-- si copia tutto in _bkp_410_leave_requests (nessun GRANT: invisibile all'API). Le proposte ancora
-- in bozza NON si cancellano: restano bozze con origine 'gestionale', da togliere a mano se serve.
-- Se la copia esiste gia' ci si ferma: va guardata prima di ripetere.
BEGIN;

DO $$ BEGIN
  IF to_regclass('public._bkp_410_leave_requests') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 410: esiste gia'' la copia _bkp_410_leave_requests. Controllarla prima di ripetere.';
  END IF;
END $$;
CREATE TABLE public._bkp_410_leave_requests AS
  SELECT id, company_id, employee_id, stato, origine, plan_id, now() AS copiato_il
    FROM public.leave_requests
   WHERE plan_id IS NOT NULL OR origine = 'piano_mese';
ALTER TABLE public._bkp_410_leave_requests ENABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS public.ferie_proposta_approva(uuid, uuid[]);

ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_origine_check;
UPDATE public.leave_requests SET origine = 'gestionale' WHERE origine = 'piano_mese';
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_origine_check
  CHECK (origine IN ('gestionale', 'modulo_cartaceo', 'mail'));

DROP INDEX IF EXISTS public.leave_requests_plan_idx;
ALTER TABLE public.leave_requests DROP COLUMN IF EXISTS plan_id;

COMMIT;
