-- =====================================================================
-- Migrazione 396 — Codice per i revisori degli store (dipendente di prova)
-- =====================================================================
-- Patrizio, 11/11/2026: Apple e Google provano l'app con un codice che deve
-- funzionare più volte e su più telefoni insieme. Il codice normale si
-- consuma al primo uso e ogni attivazione cambia il segreto, così il
-- telefono di un revisore spegnerebbe quello dell'altro.
-- 1. employee_app_access: codice_revisione e codice_revisione_scade.
-- 2. app_dipendente_consuma_codice: se il codice normale non c'è, prova il
--    codice di revisione, che vale SOLO per un dipendente is_demo e non
--    scade al primo uso. Non cambia il segreto (tutti i telefoni dei
--    revisori restano attivi insieme) e non spegne le notifiche.
-- Il codice si scrive a parte, solo sul dipendente di prova del tenant
-- dell'app (NZ), con una scadenza; non sta nel repository. La Edge Function
-- app-dipendente-attiva cerca anche questo codice (stesso PR).
-- Tenant: NZ e Zago. Rollback: 20261111_396_codice_revisione_store_ROLLBACK.sql
-- =====================================================================
BEGIN;

ALTER TABLE public.employee_app_access ADD COLUMN IF NOT EXISTS codice_revisione text;
ALTER TABLE public.employee_app_access ADD COLUMN IF NOT EXISTS codice_revisione_scade timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS employee_app_access_codice_revisione_key
  ON public.employee_app_access (codice_revisione) WHERE codice_revisione IS NOT NULL;

DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.app_dipendente_consuma_codice(text)'::regprocedure);
  n := replace(d, $x$  IF v_emp IS NULL THEN RETURN; END IF;
$x$, $x$  IF v_emp IS NULL THEN
    -- 396: codice per i revisori degli store, solo dipendente di prova, riusabile
    SELECT a.employee_id INTO v_emp
      FROM public.employee_app_access a JOIN public.employees e ON e.id = a.employee_id
     WHERE a.codice_revisione = upper(trim(p_codice)) AND a.codice_revisione_scade > now()
       AND COALESCE(e.is_demo, false);
    IF v_emp IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT e.id, e.company_id, a.segreto,
           COALESCE(e.nome, e.first_name), COALESCE(e.cognome, e.last_name), e.user_id
      FROM public.employees e JOIN public.employee_app_access a ON a.employee_id = e.id
     WHERE e.id = v_emp;
    RETURN;
  END IF;
$x$);
  IF n = d THEN RAISE EXCEPTION 'app_dipendente_consuma_codice: ancora non trovata'; END IF;
  EXECUTE n;
END
$do$;

COMMIT;
