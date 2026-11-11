-- Rollback della 402: le tre funzioni tornano ad accettare 'malattia'.
BEGIN;
DO $do$
DECLARE f text; d text; n text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.timbrature_evento_da_timbratura(uuid,text)',
                           'public.app_dipendente_motivo_evento(uuid,text,text)',
                           'public.presenze_causale_evento(uuid,text)'] LOOP
    d := pg_get_functiondef(f::regprocedure);
    n := replace(d, $x$('personale', 'accordo')$x$, $x$('personale', 'malattia', 'accordo')$x$);
    IF n = d THEN RAISE EXCEPTION '%: ancora 402 non trovata', f; END IF;
    EXECUTE n;
  END LOOP;
END
$do$;
COMMIT;
