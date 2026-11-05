-- =============================================================================
-- Migrazione 365 — Rimette la guardia del profilo su due funzioni dei gruppi
-- =============================================================================
--
-- COSA ERA SUCCESSO (05/11/2026)
--   Alle 17:26 (Roma) un'altra sessione ha applicato 20261105_364_rpc_solo_con_profilo:
--   in testa a 38 funzioni SECURITY DEFINER aggiunge
--   «PERFORM public.richiedi_profilo_gestionale();», così chi ha fatto l'accesso ma non
--   ha un profilo nel gestionale non può chiamarle.
--   Alle 17:32 è stata applicata 20261105_364_gruppo_per_nome_solo_proposta, scritta
--   prima e senza saperlo: riscrive rerun_group_reconciliation e
--   try_match_group_name_bank_transaction con CREATE OR REPLACE, e la guardia su
--   quelle due funzioni è sparita (NZ e Zago).
--
-- COSA FA
--   Stessa procedura della 364 rpc_solo_con_profilo, limitata alle due funzioni:
--   inserisce la riga della guardia subito dopo il primo BEGIN del corpo, solo se
--   manca. Rilanciabile. Il corpo delle funzioni non cambia in nient'altro.
--
-- Rollback in _ROLLBACK.sql (le due funzioni senza guardia, com'erano dopo la 364
-- gruppo_per_nome_solo_proposta).
-- PARITA' TENANT: NZ + Zago (niente Made dal 03/11/2026).
-- =============================================================================

DO $$
DECLARE
  f          record;
  v_def      text;
  v_body_at  int;
  v_begin_at int;
  v_rel      int;
  n          int := 0;
BEGIN
  IF to_regprocedure('public.richiedi_profilo_gestionale()') IS NULL THEN
    RAISE EXCEPTION '365: manca richiedi_profilo_gestionale(), applicare prima la 364 rpc_solo_con_profilo';
  END IF;

  FOR f IN
    SELECT p.oid, p.oid::regprocedure::text AS firma
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.prokind = 'f'
       AND p.prosecdef
       AND p.proname IN ('rerun_group_reconciliation', 'try_match_group_name_bank_transaction')
     ORDER BY 2
  LOOP
    v_def := pg_get_functiondef(f.oid);
    CONTINUE WHEN v_def ~ 'richiedi_profilo_gestionale';

    v_body_at := position('$function$' IN v_def);
    IF v_body_at = 0 THEN
      RAISE EXCEPTION '365: % senza corpo $function$, guardia non inserita', f.firma;
    END IF;
    v_rel := regexp_instr(substring(v_def FROM v_body_at), '\mBEGIN\M', 1, 1, 0, 'i');
    IF v_rel = 0 THEN
      RAISE EXCEPTION '365: % senza BEGIN, guardia non inserita', f.firma;
    END IF;
    v_begin_at := v_body_at + v_rel - 1;

    EXECUTE left(v_def, v_begin_at + 4)
         || E'\n  PERFORM public.richiedi_profilo_gestionale(); -- migration 364'
         || substring(v_def FROM v_begin_at + 5);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '365: guardia rimessa in % funzioni', n;
END $$;
