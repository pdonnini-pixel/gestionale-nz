-- Rollback della 392: le funzioni tornano come prima. Il vincolo sul tipo
-- resta allargato e i casi «pausa_lunga» gia' nati restano (nessun dato si
-- cancella); non ne nascono di nuovi.
BEGIN;
-- I casi ancora aperti si chiudono (senza cancellarli): dopo il rollback
-- la decisione li registrerebbe come straordinario
UPDATE public.attendance_eventi
   SET stato = 'respinto', esito = 'superata', deciso_il = now(), nota_decisione = 'Rollback 392'
 WHERE tipo = 'pausa_lunga' AND stato = 'da_confermare';
DO $do$
DECLARE d text; n text; i integer; j integer;
BEGIN
  d := pg_get_functiondef('public.timbrature_evento_da_timbratura(uuid,text)'::regprocedure);
  n := replace(d, E'  v_pausa  integer;  -- 392\n', '');
  n := replace(n, $x$p.tipo NOT IN ('entrata', 'uscita', 'fine_pausa') THEN$x$, $x$p.tipo NOT IN ('entrata', 'uscita') THEN$x$);
  i := position(E'  IF p.tipo = ''fine_pausa'' THEN\n    -- 392' in n);
  j := position(E'  ELSIF p.tipo = ''entrata'' THEN\n    IF EXISTS' in n);
  IF i = 0 OR j = 0 THEN RAISE EXCEPTION 'ancore 392 non trovate'; END IF;
  n := left(n, i - 1) || E'  IF p.tipo = ''entrata'' THEN\n    IF EXISTS' || substr(n, j + length(E'  ELSIF p.tipo = ''entrata'' THEN\n    IF EXISTS'));
  n := replace(n, $x$ WHEN 'pausa_lunga' THEN 'Pausa più lunga da confermare: '$x$, '');
  EXECUTE n;

  d := pg_get_functiondef('public.presenze_decidi_evento(uuid,boolean,integer,boolean,text)'::regprocedure);
  i := position(E'  ELSIF ev.tipo = ''pausa_lunga'' THEN' in d);
  j := position(E'  ELSE\n    v_esito := ''straordinario'';' in d);
  IF i = 0 OR j = 0 THEN RAISE EXCEPTION 'ancore 392 non trovate (decidi)'; END IF;
  EXECUTE left(d, i - 1) || substr(d, j);
END
$do$;
COMMIT;
