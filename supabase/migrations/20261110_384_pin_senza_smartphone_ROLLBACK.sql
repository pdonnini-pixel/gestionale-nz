-- Rollback della 384 (PIN per chi non ha lo smartphone).
-- Le timbrature con il PIN restano (nessun dato si cancella): il vincolo
-- sull'origine torna come prima ma NOT VALID. Le colonne del PIN restano.
BEGIN;
ALTER TABLE public.attendance_punches DROP CONSTRAINT attendance_punches_origine_check;
ALTER TABLE public.attendance_punches ADD CONSTRAINT attendance_punches_origine_check
  CHECK (origine = ANY (ARRAY['cellulare_negozio', 'dichiarata', 'manuale'])) NOT VALID;
UPDATE public.employee_app_access SET pin_hash = NULL WHERE pin_hash IS NOT NULL; -- nessun PIN resta valido

DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.timbrature_registra(jsonb)'::regprocedure);
  n := replace(d, $x$
  v_pin     boolean;  -- 384: codice NZP1.<employee_id>.<pin>$x$, '');
  n := replace(n, $x$    v_pin := COALESCE(array_length(v_parti, 1) = 3 AND v_parti[1] = 'NZP1'
             AND v_parti[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             AND v_parti[3] ~ '^[0-9]{4}$', false);
    IF NOT v_pin AND (array_length$x$, $x$    IF array_length$x$);
  n := replace(n, $x$       OR v_parti[3] !~ '^[0-9]{1,12}$') THEN$x$, $x$       OR v_parti[3] !~ '^[0-9]{1,12}$' THEN$x$);
  n := replace(n, $x$    v_passo := CASE WHEN v_pin THEN NULL ELSE v_parti[3]::bigint END;$x$, $x$    v_passo := v_parti[3]::bigint;$x$);
  n := replace(n, $x$    IF v_pin THEN
      -- 384: PIN al posto del QR; sbagliato o bloccato = rifiutata
      v_verifica := public.timbrature_pin_controlla(v_emp, v_parti[3]);
      IF v_verifica <> 'ok' THEN
        v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', v_verifica);
        CONTINUE;
      END IF;
      IF v_ora > now() + interval '5 minutes' THEN
        v_verifica := 'fuori_tempo';
      ELSIF now() - v_ora > interval '2 hours' THEN
        -- il PIN non ha l'ora dentro come il QR: arrivata tardi, la conferma chi segue il personale
        v_verifica := 'da_confermare';
      END IF;
    ELSIF public.timbrature_firma$x$, $x$    IF public.timbrature_firma$x$);
  n := replace(n, $x$ WHEN v_pin THEN 'pin' ELSE 'cellulare_negozio' END,$x$, $x$ ELSE 'cellulare_negozio' END,$x$);
  IF n ~ 'NZP1|v_pin' THEN RAISE EXCEPTION 'rollback 384: timbrature_registra non tornata come prima'; END IF;
  EXECUTE n;
  d := pg_get_functiondef('public.timbratrice_dati(uuid)'::regprocedure);
  n := replace(d, $x$,
                            'pin', EXISTS (SELECT 1 FROM public.employee_app_access x WHERE x.employee_id = p.id AND x.pin_hash IS NOT NULL))$x$, ')');
  IF n ~ 'pin_hash' THEN RAISE EXCEPTION 'rollback 384: timbratrice_dati non tornata come prima'; END IF;
  EXECUTE n;
END
$do$;

DROP FUNCTION public.app_accessi_elenco(uuid);
CREATE FUNCTION public.app_accessi_elenco(p_outlet_id uuid)
RETURNS TABLE(employee_id uuid, nome text, telefono_whatsapp text, codice text, codice_scade timestamptz, attivata_il timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
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
$fn$;
REVOKE ALL ON FUNCTION public.app_accessi_elenco(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_accessi_elenco(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.timbrature_pin_togli(uuid);
DROP FUNCTION IF EXISTS public.timbrature_pin_nuovo(uuid);
DROP FUNCTION IF EXISTS public.timbratrice_verifica_pin(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.timbrature_pin_controlla(uuid, text);
COMMIT;
