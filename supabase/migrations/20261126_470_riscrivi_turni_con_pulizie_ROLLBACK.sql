-- ROLLBACK 470: toglie dal controllo dell'orario di turni_proposti_riscrivi il pezzo delle pulizie
-- (torna identica alla 411). Nessun dato toccato.
BEGIN;
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.turni_proposti_riscrivi(uuid,date[],jsonb,jsonb)'::regprocedure);
  v_ini int := strpos(v_def, '    -- pulizie prima dell''apertura (migration 468/470)');
  v_fin int;
BEGIN
  IF v_ini = 0 THEN RETURN; END IF;
  v_fin := strpos(substr(v_def, v_ini), E'    END IF;\n') + length(E'    END IF;\n') - 1;
  EXECUTE substr(v_def, 1, v_ini - 1) || substr(v_def, v_ini + v_fin);
END $$;
COMMIT;
