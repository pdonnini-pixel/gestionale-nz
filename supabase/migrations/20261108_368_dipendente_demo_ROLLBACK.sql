-- =====================================================================
-- ROLLBACK della migrazione 368 (dipendente di prova)
-- =====================================================================
-- Ordine:
--   1. toglie i dipendenti di prova (dati finti, creati da NZ_ONLY 369):
--      senza le policy della 368 tornerebbero visibili nel gestionale e
--      nei conteggi. Si cancellano SOLO righe di dipendenti con is_demo.
--   2. toglie le policy demo_nascosto;
--   3. rimette le sei funzioni come prima della 368 (348/351/367);
--   4. toglie le due funzioni helper. La colonna employees.is_demo resta
--      (vuota, sempre false): toglierla e' un DROP COLUMN, da fare solo
--      con conferma di Patrizio.
-- =====================================================================

BEGIN;

-- 1. Dipendenti di prova e le loro righe (solo dati finti)
DELETE FROM public.leave_request_days d USING public.leave_requests q, public.employees e
 WHERE d.request_id = q.id AND q.employee_id = e.id AND e.is_demo;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'attendance_alerts', 'attendance_notifications', 'attendance_punches', 'employee_app_access',
    'employee_availability', 'employee_cost_slips', 'employee_costs', 'employee_documents',
    'employee_events', 'employee_matricole', 'employee_outlet_allocations', 'employee_push_tokens',
    'employee_trasferte', 'leave_accrual_rows', 'leave_counterproposals', 'leave_requests',
    'personnel_gross_cost_employee', 'shift_plan_weekend_off', 'shifts'
  ] LOOP
    EXECUTE format('DELETE FROM public.%I x USING public.employees e WHERE x.employee_id = e.id AND e.is_demo', t);
  END LOOP;
END;
$$;
DELETE FROM public.employees WHERE is_demo;

-- 2. Policy
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_policies WHERE policyname = 'demo_nascosto' LOOP
    EXECUTE format('DROP POLICY demo_nascosto ON %I.%I', r.schemaname, r.tablename);
  END LOOP;
END;
$$;

-- 3. Funzioni come prima
CREATE OR REPLACE FUNCTION public.app_accessi_elenco(p_outlet_id uuid)
 RETURNS TABLE(employee_id uuid, nome text, telefono_whatsapp text, codice text, codice_scade timestamp with time zone, attivata_il timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT e.id, trim(COALESCE(e.nome, e.first_name, '') || ' ' || COALESCE(e.cognome, e.last_name, '')),
         e.telefono_whatsapp, a.codice, a.codice_scade, a.attivata_il
    FROM public.employees e
    LEFT JOIN public.employee_app_access a ON a.employee_id = e.id
   WHERE e.company_id = (SELECT public.get_my_company_id())
     AND e.outlet_id = p_outlet_id AND COALESCE(e.is_active, true)
   ORDER BY 2;
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_push_stato(p_outlet_id uuid)
 RETURNS TABLE(employee_id uuid, piattaforme text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.employee_id, string_agg(DISTINCT t.piattaforma, ', ')
    FROM public.employee_push_tokens t JOIN public.employees e ON e.id = t.employee_id
   WHERE t.attivo AND e.outlet_id = p_outlet_id AND e.company_id = (SELECT public.get_my_company_id())
   GROUP BY t.employee_id;
END;
$function$;

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
          OR (p.id IS NULL AND s.plan_id IS NULL AND (s.stato = 'pubblicato' OR s.origine = 'manuale')));
$function$;

-- Le tre funzioni lunghe: si tolgono esattamente i pezzi aggiunti dalla 368
DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.timbratrice_dati(uuid)'::regprocedure);
  n := replace(d, ' AND t.employee_id <> ALL (public.dipendenti_demo_ids())', '');
  n := replace(n, ' AND NOT e.is_demo', '');
  IF n = d THEN RAISE EXCEPTION 'timbratrice_dati: pezzi della 368 non trovati'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.timbrature_avvisi_da_mandare(timestamp with time zone)'::regprocedure);
  n := replace(d, 'c.a_resp AND NOT e.is_demo, c.a_uff AND NOT e.is_demo', 'c.a_resp, c.a_uff');
  IF n = d THEN RAISE EXCEPTION 'timbrature_avvisi_da_mandare: pezzi della 368 non trovati'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.app_dipendente_chiedi_ferie(jsonb, text)'::regprocedure);
  n := replace(d, E'  IF NOT e.is_demo THEN\n', '');
  n := replace(n, E'  END IF;\n\n  RETURN v_req;', E'  RETURN v_req;');
  IF n = d THEN RAISE EXCEPTION 'app_dipendente_chiedi_ferie: pezzi della 368 non trovati'; END IF;
  EXECUTE n;
END;
$$;

-- 4. Funzioni helper
DROP FUNCTION IF EXISTS public.dipendenti_demo_ids();
DROP FUNCTION IF EXISTS public.richieste_ferie_demo_ids();

COMMIT;
