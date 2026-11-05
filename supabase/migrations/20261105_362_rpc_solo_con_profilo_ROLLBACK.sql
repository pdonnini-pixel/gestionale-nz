-- ROLLBACK della migrazione 362: rimette le definizioni delle funzioni
-- salvate in public._bkp_362_funzioni (senza la riga della guardia) e poi
-- toglie public.richiedi_profilo_gestionale(). Nessun dato toccato.
-- La tabella di backup resta: si elimina a mano solo dopo conferma.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT firma, definizione FROM public._bkp_362_funzioni ORDER BY firma LOOP
    EXECUTE r.definizione;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.richiedi_profilo_gestionale();
