-- =====================================================================
-- ROLLBACK della migrazione 378 (profilo responsabile)
-- =====================================================================
-- Toglie le funzioni nuove, rimette leave_decidi come prima e toglie le
-- policy responsabile_*. Prima di eseguirlo, nessun utente deve avere il
-- ruolo 'responsabile' (altrimenti vedrebbe le tabelle come un utente
-- normale): spostarli a 'viewer'. Il valore 'responsabile' dell'enum resta.
-- =====================================================================
BEGIN;

DO $$
DECLARE
  d text;
  n text;
  t record;
BEGIN
  d := pg_get_functiondef('public.leave_decidi(uuid, uuid[], text)'::regprocedure);
  n := replace(d, $x$IF r.company_id <> public.get_my_company_id()
     OR NOT (public.posso_decidere_ferie() OR public.ferie_responsabile_puo(p_request_id)) THEN$x$,
                  $x$IF r.company_id <> public.get_my_company_id() OR NOT public.posso_decidere_ferie() THEN$x$);
  IF n = d THEN RAISE EXCEPTION 'leave_decidi: pezzo della 378 non trovato'; END IF;
  EXECUTE n;

  FOR t IN SELECT schemaname, tablename, policyname FROM pg_policies
            WHERE policyname IN ('responsabile_block', 'responsabile_solo_suo', 'responsabile_notifiche_sue') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', t.policyname, t.schemaname, t.tablename);
  END LOOP;
END;
$$;

-- presenze_non_su_di_me e presenze_confermatori_elenco tornano come nella 373
DO $$
DECLARE
  d text;
BEGIN
  d := pg_get_functiondef('public.presenze_non_su_di_me(uuid)'::regprocedure);
  EXECUTE replace(d, 'IF public.presenze_sono_io(p_employee)', 'IF p_employee = public.timbrature_mio_dipendente()');
  d := pg_get_functiondef('public.presenze_confermatori_elenco()'::regprocedure);
  EXECUTE replace(d, $x$'dipendente_id', (SELECT r.employee_id FROM public.responsabile_dipendente r WHERE r.user_id = u.id),
             $x$, '');
END;
$$;
DROP FUNCTION IF EXISTS public.presenze_responsabile_dipendente_imposta(uuid, uuid);
DROP FUNCTION IF EXISTS public.presenze_sono_io(uuid);
-- La tabella responsabile_dipendente RESTA (configurazione): toglierla solo con conferma.
DROP FUNCTION IF EXISTS public.responsabile_ferie_elenco(boolean);
DROP FUNCTION IF EXISTS public.responsabile_negozi();
DROP FUNCTION IF EXISTS public.ferie_responsabile_puo(uuid);
DROP FUNCTION IF EXISTS public.ferie_negozio_richiesta(uuid);

COMMIT;
