-- Rollback della 383: toglie i tre limiti, torna ai testi della 382.
BEGIN;
DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.timbrature_registra(jsonb)'::regprocedure);
  n := replace(d, $x$
         AND v_ora >= now() - interval '15 minutes'  -- 383: QR di adesso
         AND NOT EXISTS (SELECT 1 FROM public.attendance_eventi x  -- 383: niente dopo una non confermata
                          WHERE x.employee_id = v_emp AND x.data = v_giorno AND x.tipo = 'entrata_dichiarata' AND x.stato = 'respinto') THEN$x$, ' THEN');
  n := replace(n, $x$ AND t.outlet_id = v_outlet;  -- 383: turno in questo negozio$x$, ';');
  EXECUTE n;
  d := pg_get_functiondef('public.app_dipendente_dichiara_entrata(time, text)'::regprocedure);
  n := replace(d, $x$  -- 383: dopo un'entrata dichiarata non confermata se ne occupa chi segue il personale
  IF EXISTS (SELECT 1 FROM public.attendance_eventi x
              WHERE x.employee_id = v_emp AND x.data = v_oggi AND x.tipo = 'entrata_dichiarata' AND x.stato = 'respinto') THEN
    RAISE EXCEPTION 'La tua entrata di oggi non è stata confermata: ne parla il responsabile con chi segue il personale.' USING ERRCODE = '22023';
  END IF;
$x$, '');
  EXECUTE n;
  d := pg_get_functiondef('public.timbrature_conferma(uuid)'::regprocedure);
  n := replace(d, $x$  -- 383: nessuno conferma una propria timbratura
  PERFORM public.presenze_non_su_di_me((SELECT a.employee_id FROM public.attendance_punches a WHERE a.id = p_id));
$x$, '');
  EXECUTE n;
END
$do$;
COMMIT;
