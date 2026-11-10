-- Rollback della 387: app_dipendente_oggi senza l'impronta.
BEGIN;
DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.app_dipendente_oggi()'::regprocedure);
  n := replace(d, $x$    'impronta', (SELECT left(encode(sha256(convert_to(x.segreto, 'UTF8')), 'hex'), 16)
                   FROM public.employee_app_access x WHERE x.employee_id = v_emp),  -- 387
$x$, '');
  IF n ~ '-- 387' THEN RAISE EXCEPTION 'rollback 387: testo non tornato'; END IF;
  EXECUTE n;
END
$do$;
COMMIT;
