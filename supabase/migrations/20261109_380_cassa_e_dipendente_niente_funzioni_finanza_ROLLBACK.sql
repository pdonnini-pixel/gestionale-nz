-- ROLLBACK della 380: toglie la riga aggiunta in testa alle funzioni e la
-- funzione di guardia. La tabella _bkp_380_funzioni resta (storico, nessun
-- GRANT): si toglie a mano solo con conferma di Patrizio.
BEGIN;
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN SELECT oid FROM pg_proc
            WHERE pronamespace = 'public'::regnamespace AND prokind = 'f'
              AND pg_get_functiondef(oid) ~ 'ruoli_operativi_non_qui\(\); -- migration 380'
  LOOP
    EXECUTE replace(pg_get_functiondef(p.oid),
                    E'  PERFORM public.ruoli_operativi_non_qui(); -- migration 380\n', '');
  END LOOP;
END;
$$;
DROP FUNCTION IF EXISTS public.ruoli_operativi_non_qui();
COMMIT;
