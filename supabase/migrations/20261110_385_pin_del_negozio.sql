-- =====================================================================
-- Migrazione 385 — PIN: solo nel proprio negozio, ora piu' stretta
-- =====================================================================
-- Dalla revisione di sicurezza della 384:
-- 1. Il PIN vale solo per chi e' di quel negozio (anagrafica) o ha un turno
--    ufficiale li' quel giorno: dal telefono di un altro negozio non si
--    provano (e non si bloccano) i PIN dei colleghi.
-- 2. Il PIN non porta l'ora dentro come il QR: una timbratura con il PIN che
--    arriva al server piu' di 30 minuti dopo (prima: 2 ore) resta
--    'da_confermare'.
-- Testi ritoccati sul vivo con controllo dell'ancora. Tenant: NZ e Zago.
-- Rollback: 20261110_385_pin_del_negozio_ROLLBACK.sql
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.timbrature_pin_del_negozio(p_emp uuid, p_outlet uuid, p_giorno date)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_emp AND e.outlet_id = p_outlet)
      OR EXISTS (SELECT 1 FROM public.employees e,
                        LATERAL public.timbrature_turni_ufficiali(e.company_id, p_giorno, p_giorno) t
                  WHERE e.id = p_emp AND t.employee_id = p_emp AND t.outlet_id = p_outlet);
$fn$;
REVOKE ALL ON FUNCTION public.timbrature_pin_del_negozio(uuid, uuid, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timbrature_pin_del_negozio(uuid, uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.timbratrice_verifica_pin(p_outlet_id uuid, p_employee uuid, p_pin text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.timbrature_puo_timbrare(p_outlet_id) THEN
    RAISE EXCEPTION 'Non puoi timbrare in questo negozio' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e
                  WHERE e.id = p_employee AND e.company_id = (SELECT public.get_my_company_id()) AND COALESCE(e.is_active, true)) THEN
    RETURN 'pin_non_attivo';
  END IF;
  -- 385: solo chi e' di questo negozio o ci ha un turno oggi
  IF NOT public.timbrature_pin_del_negozio(p_employee, p_outlet_id, (now() AT TIME ZONE 'Europe/Rome')::date) THEN
    RETURN 'pin_altro_negozio';
  END IF;
  RETURN public.timbrature_pin_controlla(p_employee, p_pin);
END;
$fn$;

DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.timbrature_registra(jsonb)'::regprocedure);
  n := replace(d, $x$      v_verifica := public.timbrature_pin_controlla(v_emp, v_parti[3]);$x$,
  $x$      -- 385: solo chi e' di questo negozio o ci ha un turno quel giorno
      IF NOT public.timbrature_pin_del_negozio(v_emp, v_outlet, (v_ora AT TIME ZONE 'Europe/Rome')::date) THEN
        v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', 'pin_altro_negozio');
        CONTINUE;
      END IF;
      v_verifica := public.timbrature_pin_controlla(v_emp, v_parti[3]);$x$);
  IF n = d THEN RAISE EXCEPTION 'timbrature_registra: ancora 1 non trovata'; END IF;
  d := n;
  n := replace(d, $x$      ELSIF now() - v_ora > interval '2 hours' THEN$x$, $x$      ELSIF now() - v_ora > interval '30 minutes' THEN  -- 385$x$);
  IF n = d THEN RAISE EXCEPTION 'timbrature_registra: ancora 2 non trovata'; END IF;
  EXECUTE n;
END
$do$;

COMMIT;
-- Verifica: SELECT pg_get_functiondef('public.timbrature_registra(jsonb)'::regprocedure) ~ 'pin_altro_negozio';
