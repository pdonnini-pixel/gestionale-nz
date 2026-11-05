-- =====================================================================
-- Migrazione 362 — Le funzioni SECURITY DEFINER rispondono solo a chi ha
-- un profilo nel gestionale
-- =====================================================================
-- COSA NON ANDAVA (verifica del 05/11/2026 su NZ e Zago, seguito della 360):
--   la registrazione libera di Supabase Auth era aperta. Un account
--   autoregistrato e' «authenticated» ma non ha riga in user_profiles.
--   La 360 lo ferma sulle tabelle con la RLS, ma le funzioni SECURITY
--   DEFINER girano come proprietario e la RLS non le tocca. Sul DB vivo:
--     SELECT ... WHERE prosecdef AND has_function_privilege('authenticated', ...)
--       AND pg_get_functiondef(...) !~* '(get_my_company_id|get_my_role|auth\.uid)'
--   restituiva 61 funzioni su NZ e 60 su Zago. Tolti i trigger (PostgREST non
--   li espone), le SQL di sola lettura di un booleano o due nomi, le funzioni
--   con un controllo proprio (app_dipendente_* via timbrature_mio_dipendente,
--   password_sync_receive via segreto nell'header, has_jwt_role) e i due
--   *_endpoint (restituiscono URL e chiave pubblica), restano 38 funzioni su
--   NZ e 37 su Zago che scrivono o ricalcolano dati: riconciliazione,
--   chiusure provvisorie, sync A-Cube, invii dei report, budget.
--
-- COSA FA (solo aggiunte, logica invariata):
--   1. public.richiedi_profilo_gestionale(): se la chiamata arriva da un
--      utente (ruolo authenticated o anon) senza profilo
--      ((SELECT get_my_role()) IS NULL, stesso criterio della 360) alza
--      l'errore 42501 «Account non abilitato al gestionale». Per cron
--      (postgres, nessun JWT) e service role (Edge Function) non fa niente.
--   2. Salva in public._bkp_362_funzioni la definizione attuale
--      (pg_get_functiondef) di ogni funzione dell'elenco.
--   3. Per ognuna: CREATE OR REPLACE con la stessa definizione e una sola
--      riga in piu', subito dopo il BEGIN del blocco esterno:
--        PERFORM public.richiedi_profilo_gestionale();
--      CREATE OR REPLACE conserva proprietario, GRANT, SECURITY DEFINER e
--      search_path (sono nella definizione).
--   Chi ha un profilo (tutti gli utenti veri, compresi cassa, dipendente e
--   viewer) non vede differenze. Rilanciabile: salta le funzioni che hanno
--   gia' la guardia.
--
-- ROLLBACK: 20261105_362_rpc_solo_con_profilo_ROLLBACK.sql rimette le
-- definizioni salvate nella tabella di backup.
--
-- PARITA' TENANT: dal 03/11/2026 NZ + Zago (niente Made).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.richiedi_profilo_gestionale()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.role(), '') IN ('authenticated', 'anon')
     AND (SELECT public.get_my_role()) IS NULL THEN
    RAISE EXCEPTION 'Account non abilitato al gestionale'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- La chiamano solo le funzioni SECURITY DEFINER (come proprietario):
-- nessun ruolo dell'API deve poterla eseguire direttamente.
REVOKE ALL ON FUNCTION public.richiedi_profilo_gestionale() FROM PUBLIC, anon, authenticated;

-- Tabella di backup: RLS attiva, nessun GRANT (invisibile all'API).
CREATE TABLE IF NOT EXISTS public._bkp_362_funzioni (
  firma        text PRIMARY KEY,
  definizione  text NOT NULL,
  salvata_il   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public._bkp_362_funzioni ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bkp_362_funzioni FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  f          record;
  v_def      text;
  v_body_at  int;
  v_begin_at int;
  v_rel      int;
  n          int := 0;
BEGIN
  FOR f IN
    SELECT p.oid, p.oid::regprocedure::text AS firma
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE ns.nspname = 'public'
       AND p.prokind = 'f'
       AND p.prosecdef
       AND l.lanname = 'plpgsql'
       AND p.prorettype <> 'trigger'::regtype
       AND p.proname IN (
         'acube_ob_sync_all_production', 'align_payable_categories',
         'apply_credit_note_links', 'check_pixel_and_alert',
         'clean_bank_category_conflicts', 'close_incoming_movements',
         'close_non_supplier_movements', 'close_paid_fiscal_deadlines',
         'close_utility_movements', 'closing_checks_dispatch',
         'closing_checks_tick', 'daily_cash_report_tick',
         'daily_report_dispatch', 'fn_cash_card_provisional_close',
         'fn_riba_provisional_close', 'fn_supplier_profile_from_invoice',
         'match_customer_transfers_with_closings', 'notify_invoices_without_xml',
         'organico_imposta_referente', 'reconcile_movement',
         'reconcile_movement_group', 'refresh_budget_consuntivo',
         'rerun_amount_reconciliation', 'rerun_bijective_reconciliation',
         'rerun_cash_card_provisional_close', 'rerun_distinta_reconciliation',
         'rerun_group_reconciliation', 'rerun_reconciliation',
         'rerun_riba_provisional_close', 'rpc_merge_manual_notula',
         'run_daily_reconciliation', 'storni_altri_giorni_da_foto',
         'try_match_bank_transaction', 'try_match_distinta_bank_transaction',
         'try_match_group_bank_transaction', 'try_match_group_name_bank_transaction',
         'try_match_group_numbers_bank_transaction', 'undo_reconcile_movement'
       )
     ORDER BY 2
  LOOP
    v_def := pg_get_functiondef(f.oid);
    CONTINUE WHEN v_def ~ 'richiedi_profilo_gestionale';

    v_body_at := position('$function$' IN v_def);
    IF v_body_at = 0 THEN
      RAISE EXCEPTION '362: % senza corpo $function$, guardia non inserita', f.firma;
    END IF;
    v_rel := regexp_instr(substring(v_def FROM v_body_at), '\mBEGIN\M', 1, 1, 0, 'i');
    IF v_rel = 0 THEN
      RAISE EXCEPTION '362: % senza BEGIN, guardia non inserita', f.firma;
    END IF;
    v_begin_at := v_body_at + v_rel - 1;   -- posizione della B di BEGIN

    INSERT INTO public._bkp_362_funzioni (firma, definizione)
    VALUES (f.firma, v_def)
    ON CONFLICT (firma) DO NOTHING;

    EXECUTE left(v_def, v_begin_at + 4)
         || E'\n  PERFORM public.richiedi_profilo_gestionale(); -- migration 362'
         || substring(v_def FROM v_begin_at + 5);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '362: guardia inserita in % funzioni', n;
END $$;

-- Verifica (attese: NZ 38, Zago 37 funzioni con la guardia; 0 righe nella
-- seconda query):
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND pg_get_functiondef(p.oid) ~ 'PERFORM public.richiedi_profilo_gestionale\(\)';
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     JOIN pg_language l ON l.oid = p.prolang
--    WHERE n.nspname = 'public' AND p.prosecdef AND p.prokind = 'f' AND l.lanname = 'plpgsql'
--      AND p.prorettype <> 'trigger'::regtype
--      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
--      AND pg_get_functiondef(p.oid) !~* '(get_my_company_id|get_my_role|auth\.uid|richiedi_profilo_gestionale)'
--      AND p.proname !~ '^app_dipendente_'
--      AND p.proname NOT IN ('password_sync_receive','daily_report_endpoint','ticket_notify_endpoint','has_jwt_role');
