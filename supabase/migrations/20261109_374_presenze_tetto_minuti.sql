-- =====================================================================
-- Migrazione 374 — Presenze: tetto ai minuti confermati
-- =====================================================================
-- Dalla revisione di sicurezza della 373: un responsabile di negozio poteva
-- confermare un ritardo di 10 minuti come permesso di 24 ore (o uno
-- straordinario di 24 ore). Ora chi non e' amministratore puo' confermare
-- al massimo la proposta (ritardo: blocchi di 15; uscita: i minuti mancanti
-- al turno; straordinario: i minuti dopo la fine del turno). Gli
-- amministratori (timbrature_gestore) restano liberi fino a 24 ore.
--
-- NO DATA LOSS: solo la funzione presenze_decidi_evento cambia.
-- Tenant: NZ e Zago. Rollback: 20261109_374_presenze_tetto_minuti_ROLLBACK.sql
-- =====================================================================

BEGIN;

DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.presenze_decidi_evento(uuid, boolean, integer, boolean, text)'::regprocedure);
  n := replace(d, $x$  IF v_min IS NULL OR v_min <= 0 OR v_min > 1440 THEN
    RAISE EXCEPTION 'Minuti non validi' USING ERRCODE = '22023';
  END IF;$x$, $x$  IF v_min IS NULL OR v_min <= 0 OR v_min > 1440 THEN
    RAISE EXCEPTION 'Minuti non validi' USING ERRCODE = '22023';
  END IF;
  -- Tetto per chi non e' amministratore (migration 374)
  IF NOT public.timbrature_gestore()
     AND v_min > GREATEST(ev.minuti_proposti, CASE WHEN ev.tipo = 'ritardo' THEN 0 ELSE ev.minuti END) THEN
    RAISE EXCEPTION 'Puoi confermare al massimo % minuti: per di più serve un amministratore.',
      GREATEST(ev.minuti_proposti, CASE WHEN ev.tipo = 'ritardo' THEN 0 ELSE ev.minuti END) USING ERRCODE = '22023';
  END IF;$x$);
  IF n = d THEN RAISE EXCEPTION 'presenze_decidi_evento: testo atteso non trovato'; END IF;
  EXECUTE n;
END;
$$;

COMMIT;
