-- ROLLBACK della migrazione 364: rimette le definizioni delle funzioni
-- salvate in public._bkp_364_funzioni (senza la riga della guardia) e poi
-- toglie public.richiedi_profilo_gestionale(). Nessun dato toccato.
-- La tabella di backup resta: si elimina a mano solo dopo conferma.
-- ATTENZIONE: rimette la definizione salvata all'ultimo lancio della 364.
-- Se dopo quel lancio una migration ha riscritto una di queste funzioni
-- senza rilanciare la 364, il rollback riporterebbe il corpo vecchio:
-- confronta prima _bkp_364_funzioni con pg_get_functiondef.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT firma, definizione FROM public._bkp_364_funzioni ORDER BY firma LOOP
    EXECUTE r.definizione;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.richiedi_profilo_gestionale();
