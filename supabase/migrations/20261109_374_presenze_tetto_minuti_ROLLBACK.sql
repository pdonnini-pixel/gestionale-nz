-- ROLLBACK della migrazione 374: toglie il tetto ai minuti confermati.
BEGIN;

DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.presenze_decidi_evento(uuid, boolean, integer, boolean, text)'::regprocedure);
  n := replace(d, $x$
  -- Tetto per chi non e' amministratore (migration 374)
  IF NOT public.timbrature_gestore()
     AND v_min > GREATEST(ev.minuti_proposti, CASE WHEN ev.tipo = 'ritardo' THEN 0 ELSE ev.minuti END) THEN
    RAISE EXCEPTION 'Puoi confermare al massimo % minuti: per di più serve un amministratore.',
      GREATEST(ev.minuti_proposti, CASE WHEN ev.tipo = 'ritardo' THEN 0 ELSE ev.minuti END) USING ERRCODE = '22023';
  END IF;$x$, '');
  IF n = d THEN RAISE EXCEPTION 'presenze_decidi_evento: pezzo della 374 non trovato'; END IF;
  EXECUTE n;
END;
$$;

COMMIT;
