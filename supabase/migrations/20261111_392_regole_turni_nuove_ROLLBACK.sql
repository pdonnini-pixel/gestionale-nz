-- ROLLBACK della 392. La colonna riempi_contratto e la tabella
-- employee_giorno_libero restano (contengono scelte fatte dalle persone):
-- si riporta solo la funzione dei turni ufficiali a com'era prima.

BEGIN;

CREATE OR REPLACE FUNCTION public.timbrature_turni_ufficiali(p_company_id uuid, p_dal date, p_al date)
 RETURNS TABLE(shift_id uuid, outlet_id uuid, employee_id uuid, data date, inizio time without time zone, fine time without time zone, pausa_minuti smallint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.id, s.outlet_id, s.employee_id, s.data, s.inizio, s.fine, s.pausa_minuti
    FROM public.shifts s
    LEFT JOIN public.shift_plans p
      ON p.outlet_id = s.outlet_id AND p.mese = date_trunc('month', s.data)::date AND p.stato = 'scelto'
   WHERE s.company_id = p_company_id
     AND s.data BETWEEN p_dal AND p_al
     AND s.stato <> 'annullato'
     AND ((p.id IS NOT NULL AND s.plan_id = p.id)
          OR (p.id IS NULL AND s.plan_id IS NULL AND (s.stato = 'pubblicato' OR s.origine = 'manuale'))
          OR (s.plan_id IS NULL AND s.employee_id = ANY ((SELECT public.dipendenti_demo_ids())::uuid[])));
$function$;

COMMIT;
