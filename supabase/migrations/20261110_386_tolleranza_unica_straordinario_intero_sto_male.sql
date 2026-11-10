-- =====================================================================
-- Migrazione 386 — Tolleranza unica, straordinario intero, «sto male»
-- =====================================================================
-- Decisioni di Patrizio del 10/11/2026:
--   1. «Lo stesso margine di tolleranza per entrata e uscita», 10 minuti.
--      Il margine d'uscita segue sempre la tolleranza d'entrata (trigger su
--      attendance_settings e attendance_regole_dipendente). Roma Soratte,
--      unico negozio con impostazioni: era 10 entrata / 15 uscita, diventa
--      10 / 10. Eccezioni per persona: nessuna su NZ e Zago al 10/11/2026.
--   2. «Lo straordinario va pagato tutto»: oltre la tolleranza si propongono
--      tutti i minuti dopo la fine del turno (Marco, 19:00 -> 19:40: 40
--      minuti, non 25). minuti_proposti = minuti. Nessuno straordinario era
--      ancora da confermare al 10/11/2026.
--   3. «Sto male» non e' malattia: lo diventa solo con il certificato
--      medico. Alla conferma e' un permesso (come il motivo personale);
--      chi conferma sceglie «ha il certificato medico» e allora e' malattia
--      (presenze_decidi_evento con p_scala_permesso = false). Il caso ancora
--      da confermare su NZ seguira' la regola nuova.
-- Tenant: NZ e Zago. Rollback: 20261110_386_..._ROLLBACK.sql
-- =====================================================================
BEGIN;

-- 1. Tolleranza unica ------------------------------------------------------
ALTER TABLE public.attendance_settings ALTER COLUMN margine_uscita_minuti SET DEFAULT 10;

CREATE OR REPLACE FUNCTION public.attendance_margine_come_tolleranza()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.margine_uscita_minuti := NEW.tolleranza_entrata_minuti;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.attendance_margine_come_tolleranza() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_margine_come_tolleranza ON public.attendance_settings;
CREATE TRIGGER trg_margine_come_tolleranza BEFORE INSERT OR UPDATE ON public.attendance_settings
  FOR EACH ROW EXECUTE FUNCTION public.attendance_margine_come_tolleranza();
DROP TRIGGER IF EXISTS trg_margine_come_tolleranza ON public.attendance_regole_dipendente;
CREATE TRIGGER trg_margine_come_tolleranza BEFORE INSERT OR UPDATE ON public.attendance_regole_dipendente
  FOR EACH ROW EXECUTE FUNCTION public.attendance_margine_come_tolleranza();

-- Allinea le righe esistenti (il trigger copia la tolleranza nel margine)
UPDATE public.attendance_settings SET updated_at = now() WHERE margine_uscita_minuti IS DISTINCT FROM tolleranza_entrata_minuti;
UPDATE public.attendance_regole_dipendente SET updated_at = now() WHERE margine_uscita_minuti IS DISTINCT FROM tolleranza_entrata_minuti;

DO $do$
DECLARE d text; n text;
BEGIN
  -- Senza impostazioni: 10 e 10
  d := pg_get_functiondef('public.timbrature_regole(uuid, uuid)'::regprocedure);
  n := replace(d, $x$COALESCE(rd.margine_uscita_minuti, s.margine_uscita_minuti, 15)::integer$x$,
                  $x$COALESCE(rd.margine_uscita_minuti, s.margine_uscita_minuti, 10)::integer$x$);
  IF n = d THEN RAISE EXCEPTION 'timbrature_regole: ancora non trovata'; END IF;
  EXECUTE n;

  -- 2. Straordinario intero
  d := pg_get_functiondef('public.timbrature_evento_da_timbratura(uuid, text)'::regprocedure);
  n := replace(d, $x$           v_min, v_min - v_marg, v_tol, v_marg,$x$, $x$           v_min, v_min, v_tol, v_marg,  -- 386: lo straordinario si paga tutto$x$);
  IF n = d THEN RAISE EXCEPTION 'timbrature_evento_da_timbratura: ancora non trovata'; END IF;
  EXECUTE n;

  -- 3. «Sto male»: permesso, malattia solo con il certificato
  d := pg_get_functiondef('public.presenze_decidi_evento(uuid, boolean, integer, boolean, text)'::regprocedure);
  n := replace(d, $x$    ELSIF ev.causale = 'malattia' THEN
      v_esito := 'malattia';$x$,
  $x$    ELSIF ev.causale = 'malattia' AND p_scala_permesso IS FALSE THEN
      -- 386: malattia solo con il certificato medico
      v_esito := 'malattia';
    ELSIF ev.causale = 'malattia' THEN
      -- 386: «sto male» senza certificato e' un permesso
      v_esito := 'permesso'; v_scala := true;
      v_req := public.presenze_crea_permesso(p_evento, v_min, 'Uscita per malessere del ' || v_giorno);$x$);
  IF n = d THEN RAISE EXCEPTION 'presenze_decidi_evento: ancora non trovata'; END IF;
  EXECUTE n;
END
$do$;

COMMIT;
-- Verifica:
-- SELECT tolleranza_entrata_minuti, margine_uscita_minuti FROM attendance_settings;   -- uguali
-- SELECT pg_get_functiondef('public.timbrature_evento_da_timbratura(uuid, text)'::regprocedure) ~ '386',
--        pg_get_functiondef('public.presenze_decidi_evento(uuid, boolean, integer, boolean, text)'::regprocedure) ~ 'certificato';
