-- Rollback della 396: la funzione torna come prima e il codice di revisione
-- si spegne (colonne lasciate, senza valore). Nessun dato cancellato.
BEGIN;
DO $do$
DECLARE d text; i integer; j integer; k text := E'  IF v_emp IS NULL THEN\n    -- 396';
BEGIN
  d := pg_get_functiondef('public.app_dipendente_consuma_codice(text)'::regprocedure);
  i := position(k in d);
  j := position(E'    RETURN;\n  END IF;\n' in d);
  IF i = 0 OR j = 0 THEN RAISE EXCEPTION 'ancora 396 non trovata'; END IF;
  EXECUTE left(d, i - 1) || E'  IF v_emp IS NULL THEN RETURN; END IF;\n' || substr(d, j + length(E'    RETURN;\n  END IF;\n'));
END
$do$;
UPDATE public.employee_app_access SET codice_revisione = NULL, codice_revisione_scade = NULL WHERE codice_revisione IS NOT NULL;
COMMIT;
