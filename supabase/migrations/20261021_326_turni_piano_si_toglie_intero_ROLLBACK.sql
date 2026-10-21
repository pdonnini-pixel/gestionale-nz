-- Rollback 326: torna la regola della 3xx (solo le proposte in bozza si tolgono).
CREATE OR REPLACE FUNCTION public.shifts_no_hard_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT (OLD.origine = 'proposta' AND OLD.stato = 'bozza') THEN
    RAISE EXCEPTION 'Un turno messo a mano o gia'' pubblicato non si cancella: si annulla (stato = annullato).';
  END IF;
  RETURN OLD;
END;
$function$;
