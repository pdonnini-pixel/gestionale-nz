-- Rollback della 386. Il margine di Roma Soratte torna a 15 (valore del 10/11/2026 prima della 386).
BEGIN;
DROP TRIGGER IF EXISTS trg_margine_come_tolleranza ON public.attendance_settings;
DROP TRIGGER IF EXISTS trg_margine_come_tolleranza ON public.attendance_regole_dipendente;
DROP FUNCTION IF EXISTS public.attendance_margine_come_tolleranza();
ALTER TABLE public.attendance_settings ALTER COLUMN margine_uscita_minuti SET DEFAULT 15;
UPDATE public.attendance_settings SET margine_uscita_minuti = 15 WHERE outlet_id = '8836bde0-3a78-4abe-afce-98b0c354c7c7'; -- solo NZ: Roma Soratte
DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.timbrature_regole(uuid, uuid)'::regprocedure);
  n := replace(d, $x$s.margine_uscita_minuti, 10)::integer$x$, $x$s.margine_uscita_minuti, 15)::integer$x$);
  EXECUTE n;
  d := pg_get_functiondef('public.timbrature_evento_da_timbratura(uuid, text)'::regprocedure);
  n := replace(d, $x$           v_min, v_min, v_tol, v_marg,  -- 386: lo straordinario si paga tutto$x$, $x$           v_min, v_min - v_marg, v_tol, v_marg,$x$);
  IF n ~ '-- 386' THEN RAISE EXCEPTION 'rollback 386: evento non tornato'; END IF;
  EXECUTE n;
  d := pg_get_functiondef('public.presenze_decidi_evento(uuid, boolean, integer, boolean, text)'::regprocedure);
  n := replace(d, $x$    ELSIF ev.causale = 'malattia' AND p_scala_permesso IS FALSE THEN
      -- 386: malattia solo con il certificato medico
      v_esito := 'malattia';
    ELSIF ev.causale = 'malattia' THEN
      -- 386: «sto male» senza certificato e' un permesso
      v_esito := 'permesso'; v_scala := true;
      v_req := public.presenze_crea_permesso(p_evento, v_min, 'Uscita per malessere del ' || v_giorno);$x$,
  $x$    ELSIF ev.causale = 'malattia' THEN
      v_esito := 'malattia';$x$);
  IF n ~ '-- 386' THEN RAISE EXCEPTION 'rollback 386: decisione non tornata'; END IF;
  EXECUTE n;
END
$do$;
COMMIT;
