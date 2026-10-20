-- ROLLBACK 321 (solo con conferma di Patrizio: le simulazioni salvate diventano bozze normali).
DROP TRIGGER IF EXISTS trg_shifts_simulazione_non_pubblica ON public.shifts;
DROP FUNCTION IF EXISTS public.shifts_simulazione_non_pubblica();
CREATE OR REPLACE FUNCTION public.shift_plans_guardia()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.stato = 'scelto' AND (TG_OP = 'INSERT' OR OLD.stato IS DISTINCT FROM 'scelto') AND NOT public.organico_e_hr() THEN
    RAISE EXCEPTION 'Il piano che vale lo sceglie la responsabile HR.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
ALTER TABLE public.shift_plans DROP COLUMN IF EXISTS simulazione;
