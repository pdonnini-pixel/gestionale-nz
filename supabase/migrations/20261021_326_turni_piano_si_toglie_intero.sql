-- 326 · Un piano del mese si toglie intero, anche con turni messi a mano (Patrizio, 21/10/2026)
--
-- «Mi deve far cancellare sempre le simulazioni anche se gia' modificate.»
-- La regola «un turno messo a mano non si cancella, si annulla» resta per i
-- turni settimanali (plan_id NULL). Un turno che appartiene a un piano del mese
-- si puo' togliere insieme al piano finche' non e' pubblicato: i turni
-- pubblicati restano protetti, e un piano che ne ha non si toglie (vincolo
-- della chiave esterna). Mese chiuso: lo blocca gia' trg_shifts_mese_chiuso.
CREATE OR REPLACE FUNCTION public.shifts_no_hard_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.origine = 'proposta' AND OLD.stato = 'bozza' THEN
    RETURN OLD;
  END IF;
  IF OLD.plan_id IS NOT NULL AND OLD.stato <> 'pubblicato' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Un turno gia'' pubblicato, o messo a mano fuori da un piano del mese, non si cancella: si annulla (stato = annullato).';
END;
$function$;
