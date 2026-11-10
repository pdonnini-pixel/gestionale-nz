-- Rollback della 388. I telefoni spenti restano spenti (si riaccendono da soli alla prossima apertura dell'app).
BEGIN;
DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.app_dipendente_consuma_codice(text)'::regprocedure);
  n := replace(d, $x$  -- 388: le notifiche vanno solo al telefono che si sta attivando (si riregistra subito dopo)
  UPDATE public.employee_push_tokens t
     SET attivo = false, disattivato_per_cambio = true, aggiornato_il = now()
   WHERE t.employee_id = v_emp AND t.attivo;
$x$, '');
  IF n ~ '-- 388' THEN RAISE EXCEPTION 'rollback 388: testo non tornato'; END IF;
  EXECUTE n;
END
$do$;
DROP FUNCTION public.app_registra_push_token(text, text, text);
CREATE FUNCTION public.app_registra_push_token(p_token text, p_piattaforma text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_emp  uuid := public.timbrature_mio_dipendente();
  v_comp uuid;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Accesso non collegato a un dipendente' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_piattaforma, '') NOT IN ('android', 'ios') OR length(COALESCE(p_token, '')) NOT BETWEEN 20 AND 4096 THEN
    RAISE EXCEPTION 'Telefono non valido' USING ERRCODE = '22023';
  END IF;
  SELECT company_id INTO v_comp FROM public.employees WHERE id = v_emp;
  INSERT INTO public.employee_push_tokens (company_id, employee_id, user_id, token, piattaforma)
  VALUES (v_comp, v_emp, (SELECT auth.uid()), p_token, p_piattaforma)
  ON CONFLICT (token) DO UPDATE
     SET company_id = EXCLUDED.company_id, employee_id = EXCLUDED.employee_id, user_id = EXCLUDED.user_id,
         piattaforma = EXCLUDED.piattaforma, attivo = true, aggiornato_il = now();
END;
$fn$;
REVOKE ALL ON FUNCTION public.app_registra_push_token(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_registra_push_token(text, text) TO authenticated, service_role;
COMMIT;
