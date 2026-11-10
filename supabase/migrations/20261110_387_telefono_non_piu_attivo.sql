-- =====================================================================
-- Migrazione 387 — App del dipendente: «questo telefono non è più attivo»
-- =====================================================================
-- Prova di Patrizio del 10/11/2026: il dipendente demo attivato su un
-- Android ha reso non valido il QR dell'iPhone (giusto: un telefono per
-- persona), ma l'iPhone continuava a mostrare il QR e le timbrature venivano
-- salvate come «codice non valido» senza che nessuno se ne accorgesse.
-- app_dipendente_oggi restituisce l'impronta del segreto attuale (primi 16
-- caratteri dello SHA-256): l'app la confronta con quella del segreto che ha
-- in memoria e, se non coincide, smette di mostrare il QR e chiede un codice
-- nuovo. L'impronta non permette di ricavare il segreto (160 bit casuali).
-- Tenant: NZ e Zago. Rollback: 20261110_387_telefono_non_piu_attivo_ROLLBACK.sql
-- =====================================================================
BEGIN;
DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.app_dipendente_oggi()'::regprocedure);
  n := replace(d, $x$    'persona', (SELECT jsonb_build_object('id', e.id,$x$,
    $x$    'impronta', (SELECT left(encode(sha256(convert_to(x.segreto, 'UTF8')), 'hex'), 16)
                   FROM public.employee_app_access x WHERE x.employee_id = v_emp),  -- 387
    'persona', (SELECT jsonb_build_object('id', e.id,$x$);
  IF n = d THEN RAISE EXCEPTION 'app_dipendente_oggi: ancora non trovata'; END IF;
  EXECUTE n;
END
$do$;
COMMIT;
