-- =====================================================================
-- Migrazione 383 — Entrata dichiarata: limiti dalle revisioni della 382
-- =====================================================================
-- 1. timbrature_registra: l'entrata dichiarata dal telefono del negozio vale
--    solo se l'ora del QR e' di adesso (al massimo 15 minuti fa) e il turno
--    e' in quel negozio. Prima bastava un QR valido con l'ora del telefono
--    fino a 36 ore indietro. Altrimenti si salva come entrata normale.
-- 2. Dopo un'entrata dichiarata NON confermata, la stessa giornata non se ne
--    dichiara un'altra (ne' dall'app ne' dal telefono del negozio): se ne
--    occupa chi segue il personale.
-- 3. timbrature_conferma (Giornata): anche il ramo senza caso rifiuta chi
--    conferma una propria timbratura (presenze_non_su_di_me).
-- Testi ritoccati sul vivo con controllo dell'ancora. Tenant: NZ e Zago.
-- Rollback: 20261110_383_entrata_dichiarata_limiti_ROLLBACK.sql
-- =====================================================================
BEGIN;
DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.timbrature_registra(jsonb)'::regprocedure);
  n := replace(d,
    $x$      IF v_dich IS NOT NULL AND v_dich <= v_ora AND (v_dich AT TIME ZONE 'Europe/Rome')::date = v_giorno THEN$x$,
    $x$      IF v_dich IS NOT NULL AND v_dich <= v_ora AND (v_dich AT TIME ZONE 'Europe/Rome')::date = v_giorno
         AND v_ora >= now() - interval '15 minutes'  -- 383: QR di adesso
         AND NOT EXISTS (SELECT 1 FROM public.attendance_eventi x  -- 383: niente dopo una non confermata
                          WHERE x.employee_id = v_emp AND x.data = v_giorno AND x.tipo = 'entrata_dichiarata' AND x.stato = 'respinto') THEN$x$);
  IF n = d THEN RAISE EXCEPTION 'timbrature_registra: ancora 1 non trovata'; END IF;
  d := n;
  n := replace(d,
    $x$         WHERE t.employee_id = v_emp;
        v_dich_ok$x$,
    $x$         WHERE t.employee_id = v_emp AND t.outlet_id = v_outlet;  -- 383: turno in questo negozio
        v_dich_ok$x$);
  IF n = d THEN RAISE EXCEPTION 'timbrature_registra: ancora 2 non trovata'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.app_dipendente_dichiara_entrata(time, text)'::regprocedure);
  n := replace(d,
    $x$  v_ts  := (v_oggi + p_ora) AT TIME ZONE 'Europe/Rome';$x$,
    $x$  -- 383: dopo un'entrata dichiarata non confermata se ne occupa chi segue il personale
  IF EXISTS (SELECT 1 FROM public.attendance_eventi x
              WHERE x.employee_id = v_emp AND x.data = v_oggi AND x.tipo = 'entrata_dichiarata' AND x.stato = 'respinto') THEN
    RAISE EXCEPTION 'La tua entrata di oggi non è stata confermata: ne parla il responsabile con chi segue il personale.' USING ERRCODE = '22023';
  END IF;
  v_ts  := (v_oggi + p_ora) AT TIME ZONE 'Europe/Rome';$x$);
  IF n = d THEN RAISE EXCEPTION 'app_dipendente_dichiara_entrata: ancora non trovata'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.timbrature_conferma(uuid)'::regprocedure);
  n := replace(d,
    $x$    RETURN;
  END IF;
  UPDATE public.attendance_punches$x$,
    $x$    RETURN;
  END IF;
  -- 383: nessuno conferma una propria timbratura
  PERFORM public.presenze_non_su_di_me((SELECT a.employee_id FROM public.attendance_punches a WHERE a.id = p_id));
  UPDATE public.attendance_punches$x$);
  IF n = d THEN RAISE EXCEPTION 'timbrature_conferma: ancora non trovata'; END IF;
  EXECUTE n;
END
$do$;
COMMIT;
-- Verifica: SELECT pg_get_functiondef('public.timbrature_registra(jsonb)'::regprocedure) ~ '383: QR di adesso',
--   pg_get_functiondef('public.app_dipendente_dichiara_entrata(time, text)'::regprocedure) ~ '383',
--   pg_get_functiondef('public.timbrature_conferma(uuid)'::regprocedure) ~ '383';
