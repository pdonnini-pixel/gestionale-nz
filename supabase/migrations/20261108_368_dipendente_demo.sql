-- =====================================================================
-- Migrazione 368 — Dipendente di prova (app New Zago)
-- =====================================================================
-- PERCHE': Patrizio (08/11/2026) vuole provare l'app del dipendente sul
-- telefono, e Apple e Google chiedono un account di prova per la revisione
-- degli store. Un dipendente finto sui dati veri non deve contare da
-- nessuna parte: turni e piani, organico, produttivita', costi, ferie,
-- presenze, avvisi.
--
-- COME:
--   1. employees.is_demo: il contrassegno (default false, nessun dato vero
--      cambia).
--   2. Policy RESTRICTIVE per authenticated: il gestionale non vede il
--      dipendente di prova ne' le sue righe (turni, timbrature, ferie,
--      accessi, eventi, costi...). Tutte le pagine e le viste
--      (security_invoker) lo escludono senza toccare il frontend.
--      L'app del dipendente legge con funzioni SECURITY DEFINER e quindi
--      vede i suoi dati come sempre.
--   3. Funzioni SECURITY DEFINER che leggono i dipendenti per il
--      gestionale: lo escludono (app_accessi_elenco, app_push_stato).
--      Il telefono del negozio (timbratrice_dati) invece lo vede, cosi'
--      la prova copre anche la timbratura (Patrizio, 09/11/2026).
--   4. timbrature_turni_ufficiali: i turni del dipendente di prova (senza
--      piano) valgono sempre, anche se il negozio ha un piano scelto.
--   5. Avvisi sul telefono: al dipendente di prova arrivano solo i suoi,
--      mai al responsabile o all'ufficio.
--   6. Richiesta di ferie dall'app: per il dipendente di prova nessuna
--      notifica nel gestionale.
-- Il dipendente di prova si crea a parte (NZ_ONLY_20261108_369).
--
-- APPLICATA il 09/11/2026 su NZ e Zago (20 policy demo_nascosto su entrambi).
-- NO DATA LOSS: ADD COLUMN con default, policy e funzioni. Nessuna riga
-- cambiata. Tenant: NZ e Zago (Made non ha le tabelle delle presenze).
-- =====================================================================

BEGIN;

-- 1. Il contrassegno
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.employees.is_demo IS
  'Dipendente di prova (app New Zago, revisione degli store): invisibile al gestionale e fuori da ogni conteggio. Migration 368.';

-- Elenco dei dipendenti di prova, letto senza RLS (le policy sotto lo usano)
CREATE OR REPLACE FUNCTION public.dipendenti_demo_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(array_agg(e.id), '{}'::uuid[]) FROM public.employees e WHERE e.is_demo;
$$;
REVOKE ALL ON FUNCTION public.dipendenti_demo_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.dipendenti_demo_ids() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.richieste_ferie_demo_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(array_agg(q.id), '{}'::uuid[])
    FROM public.leave_requests q JOIN public.employees e ON e.id = q.employee_id
   WHERE e.is_demo;
$$;
REVOKE ALL ON FUNCTION public.richieste_ferie_demo_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.richieste_ferie_demo_ids() TO authenticated, service_role;

-- 2. Il gestionale non vede il dipendente di prova
CREATE POLICY demo_nascosto ON public.employees AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT is_demo) WITH CHECK (NOT is_demo);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'attendance_alerts', 'attendance_notifications', 'attendance_punches', 'employee_app_access',
    'employee_availability', 'employee_cost_slips', 'employee_costs', 'employee_documents',
    'employee_events', 'employee_matricole', 'employee_outlet_allocations',
    'employee_trasferte', 'leave_accrual_rows', 'leave_counterproposals', 'leave_requests',
    'personnel_gross_cost_employee', 'shift_plan_weekend_off', 'shifts'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY demo_nascosto ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING (employee_id IS NULL OR employee_id <> ALL ((SELECT public.dipendenti_demo_ids())::uuid[]))
         WITH CHECK (employee_id IS NULL OR employee_id <> ALL ((SELECT public.dipendenti_demo_ids())::uuid[]))', t);
  END LOOP;
END;
$$;

CREATE POLICY demo_nascosto ON public.leave_request_days AS RESTRICTIVE FOR ALL TO authenticated
  USING (request_id <> ALL ((SELECT public.richieste_ferie_demo_ids())::uuid[]))
  WITH CHECK (request_id <> ALL ((SELECT public.richieste_ferie_demo_ids())::uuid[]));

-- 3. Elenchi del gestionale e del telefono del negozio
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
     AND e.outlet_id = p_outlet_id AND COALESCE(e.is_active, true) AND NOT e.is_demo
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
     AND NOT e.is_demo
   GROUP BY t.employee_id;
END;
$function$;

-- 4. Turni ufficiali: quelli del dipendente di prova valgono sempre
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

-- 5, 6: modifiche puntuali a funzioni lunghe, con controllo che il
-- testo atteso ci sia (se non c'e' la migration si ferma)
DO $$
DECLARE
  d text;
  n text;
BEGIN
  -- avvisi: il dipendente di prova li riceve solo lui
  d := pg_get_functiondef('public.timbrature_avvisi_da_mandare(timestamp with time zone)'::regprocedure);
  n := replace(d, $x$         o.referente_employee_id, c.a_dip, c.a_resp, c.a_uff$x$,
                  $x$         o.referente_employee_id, c.a_dip, c.a_resp AND NOT e.is_demo, c.a_uff AND NOT e.is_demo$x$);
  IF n = d THEN
    RAISE EXCEPTION 'timbrature_avvisi_da_mandare: testo atteso non trovato';
  END IF;
  EXECUTE n;

  -- richiesta di ferie dall'app: nessuna notifica per il dipendente di prova
  d := pg_get_functiondef('public.app_dipendente_chiedi_ferie(jsonb, text)'::regprocedure);
  n := replace(d, $x$  INSERT INTO public.notifications
    (company_id, user_id, title, message, category, severity, action_url, action_label, reference_type, reference_id)$x$,
                  $x$  IF NOT e.is_demo THEN
  INSERT INTO public.notifications
    (company_id, user_id, title, message, category, severity, action_url, action_label, reference_type, reference_id)$x$);
  n := replace(n, $x$  RETURN v_req;
END;$x$, $x$  END IF;

  RETURN v_req;
END;$x$);
  IF n = d OR (length(n) - length(d)) <> length(E'  IF NOT e.is_demo THEN\n') + length(E'  END IF;\n\n') THEN
    RAISE EXCEPTION 'app_dipendente_chiedi_ferie: testo atteso non trovato';
  END IF;
  EXECUTE n;
END;
$$;

COMMIT;

-- Verifica, su ogni tenant:
-- SELECT count(*) FROM pg_policies WHERE policyname = 'demo_nascosto';           -- 20
-- SELECT pg_get_functiondef('public.app_dipendente_chiedi_ferie(jsonb,text)'::regprocedure) ~ 'IF NOT e.is_demo';  -- true
