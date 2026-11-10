-- Rollback della 385: torna alla 384 (PIN in tutta l'azienda, 2 ore).
BEGIN;
DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.timbrature_registra(jsonb)'::regprocedure);
  n := replace(d, $x$      -- 385: solo chi e' di questo negozio o ci ha un turno quel giorno
      IF NOT public.timbrature_pin_del_negozio(v_emp, v_outlet, (v_ora AT TIME ZONE 'Europe/Rome')::date) THEN
        v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', 'pin_altro_negozio');
        CONTINUE;
      END IF;
$x$, '');
  n := replace(n, $x$      ELSIF now() - v_ora > interval '30 minutes' THEN  -- 385$x$, $x$      ELSIF now() - v_ora > interval '2 hours' THEN$x$);
  IF n ~ 'pin_altro_negozio|-- 385' THEN RAISE EXCEPTION 'rollback 385: timbrature_registra non tornata come prima'; END IF;
  EXECUTE n;
  d := pg_get_functiondef('public.timbratrice_verifica_pin(uuid, uuid, text)'::regprocedure);
  n := replace(d, $x$  -- 385: solo chi e' di questo negozio o ci ha un turno oggi
  IF NOT public.timbrature_pin_del_negozio(p_employee, p_outlet_id, (now() AT TIME ZONE 'Europe/Rome')::date) THEN
    RETURN 'pin_altro_negozio';
  END IF;
$x$, '');
  IF n ~ 'pin_altro_negozio' THEN RAISE EXCEPTION 'rollback 385: timbratrice_verifica_pin non tornata come prima'; END IF;
  EXECUTE n;
END
$do$;
DROP FUNCTION IF EXISTS public.timbrature_pin_del_negozio(uuid, uuid, date);
COMMIT;
