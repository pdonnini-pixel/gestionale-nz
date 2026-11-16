-- ROLLBACK 417 — torna alla ricerca di comune e via con position() (416).
DO $rb$
DECLARE
  v_def text := pg_get_functiondef('public.fn_riparto_automatico(uuid,boolean)'::regprocedure);
  a1 text := $a$WHERE (length(n.comune) >= 3 AND position(n.comune IN i.txt) > 0)$a$;
  b1 text := $a$WHERE (length(n.comune) >= 3 AND i.txt ~ ('\m' || regexp_replace(n.comune, '([^a-z0-9à-ù ])', '\\\1', 'g') || '\M'))$a$;
  a2 text := $a$OR (length(n.via) >= 8 AND position(n.via IN i.txt) > 0)) AS outs$a$;
  b2 text := $a$OR (length(n.via) >= 8 AND i.txt ~ ('\m' || regexp_replace(n.via, '([^a-z0-9à-ù ])', '\\\1', 'g') || '\M'))) AS outs$a$;
BEGIN
  IF position(b1 IN v_def) = 0 THEN RAISE NOTICE 'rollback 417: niente da togliere'; RETURN; END IF;
  EXECUTE replace(replace(v_def, b1, a1), b2, a2);
END
$rb$;
