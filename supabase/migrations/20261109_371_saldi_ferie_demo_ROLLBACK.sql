-- ROLLBACK della migrazione 371: app_dipendente_ferie torna come prima, via la funzione dei saldi di prova.
BEGIN;
DO $$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.app_dipendente_ferie()'::regprocedure);
  n := replace(d,
    $x$FROM public.v_leave_disponibilita d WHERE d.employee_id = v_emp),
      CASE WHEN e.is_demo THEN public.app_saldi_demo(v_emp) ELSE '[]'::jsonb END),$x$,
    $x$FROM public.v_leave_disponibilita d WHERE d.employee_id = v_emp), '[]'::jsonb),$x$);
  IF n = d THEN RAISE EXCEPTION 'app_dipendente_ferie: pezzo della 371 non trovato'; END IF;
  EXECUTE n;
END;
$$;
DROP FUNCTION IF EXISTS public.app_saldi_demo(uuid);
COMMIT;
