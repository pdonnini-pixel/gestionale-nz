-- ROLLBACK della 411: toglie le proposte di ferie del piano del mese.
-- ATTENZIONE (NO DATA LOSS): le richieste nate da una proposta e GIA' APPROVATE restano richieste
-- vere e non si toccano; cambia solo la loro origine, che torna 'gestionale' (il vincolo di prima
-- non ammette 'piano_mese'), e il legame con il piano va perso con la colonna. Per questo prima
-- si copia tutto in _bkp_411_leave_requests (nessun GRANT: invisibile all'API). Le proposte ancora
-- in bozza NON si cancellano: restano bozze con origine 'gestionale', da togliere a mano se serve.
-- Il registro di chi ha tolto le proposte e rifatto i turni (turni_piano_registro) NON si cancella:
-- la tabella viene rinominata _bkp_411_turni_piano_registro, senza GRANT e senza policy.
-- Se una copia esiste gia' ci si ferma: va guardata prima di ripetere.
BEGIN;

DO $$ BEGIN
  IF to_regclass('public._bkp_411_leave_requests') IS NOT NULL OR to_regclass('public._bkp_411_turni_piano_registro') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 411: esistono gia'' le copie _bkp_411_*. Controllarle prima di ripetere.';
  END IF;
END $$;
CREATE TABLE public._bkp_411_leave_requests AS
  SELECT id, company_id, employee_id, stato, origine, plan_id, now() AS copiato_il
    FROM public.leave_requests
   WHERE plan_id IS NOT NULL OR origine = 'piano_mese';
ALTER TABLE public._bkp_411_leave_requests ENABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS public.turni_proposti_riscrivi(uuid, date[], jsonb, jsonb);
DROP FUNCTION IF EXISTS public.ferie_proposta_sposta(uuid, date);
DROP FUNCTION IF EXISTS public.ferie_proposta_togli(uuid);
DROP FUNCTION IF EXISTS public.ferie_proposta_mia(uuid, boolean);
DROP FUNCTION IF EXISTS public.ferie_proposta_approva(uuid, uuid[], text);
DROP FUNCTION IF EXISTS public.ferie_proposta_approva(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.turni_persona_in_servizio(uuid, uuid, date);

-- il registro resta, come copia invisibile all'API
DO $$ BEGIN
  IF to_regclass('public.turni_piano_registro') IS NOT NULL THEN
    DROP POLICY IF EXISTS turni_piano_registro_select ON public.turni_piano_registro;
    DROP POLICY IF EXISTS cash_operator_block ON public.turni_piano_registro;
    DROP POLICY IF EXISTS dipendente_block ON public.turni_piano_registro;
    DROP POLICY IF EXISTS responsabile_block ON public.turni_piano_registro;
    DROP POLICY IF EXISTS solo_con_profilo ON public.turni_piano_registro;
    REVOKE ALL ON public.turni_piano_registro FROM PUBLIC, anon, authenticated, service_role;
    ALTER INDEX IF EXISTS public.turni_piano_registro_piano_idx RENAME TO _bkp_411_turni_piano_registro_piano_idx;
    ALTER TABLE public.turni_piano_registro RENAME CONSTRAINT turni_piano_registro_pkey TO _bkp_411_turni_piano_registro_pkey;
    ALTER TABLE public.turni_piano_registro RENAME TO _bkp_411_turni_piano_registro;
  END IF;
END $$;

ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_origine_check;
UPDATE public.leave_requests SET origine = 'gestionale' WHERE origine = 'piano_mese';
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_origine_check
  CHECK (origine IN ('gestionale', 'modulo_cartaceo', 'mail'));

DROP INDEX IF EXISTS public.leave_requests_plan_idx;
ALTER TABLE public.leave_requests DROP COLUMN IF EXISTS plan_id;

COMMIT;
