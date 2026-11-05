-- ROLLBACK della migrazione 365: toglie la riga della guardia del profilo dalle due
-- funzioni dei gruppi, senza riscriverne il resto (così non si perdono modifiche
-- successive). Nessun dato toccato. NZ + Zago.

DO $$
DECLARE
  r record;
  v_def text;
  v_riga constant text := E'\n  PERFORM public.richiedi_profilo_gestionale(); -- migration 364';
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('rerun_group_reconciliation', 'try_match_group_name_bank_transaction')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    CONTINUE WHEN position(v_riga IN v_def) = 0;
    EXECUTE replace(v_def, v_riga, '');
  END LOOP;
END $$;
