-- 069: v_payables_operative -> SECURITY INVOKER (chiude advisor 0010_security_definer_view)
-- NB: numerato 069 perché 068 era già occupato su main (personnel_gross_cost, PR #189).
-- Non distruttivo: cambia solo il contesto di esecuzione della view, nessun dato toccato.
-- La view legge payables/outlets/suppliers/cost_categories/payable_actions/user_profiles,
-- tutte con RLS + policy SELECT per authenticated (user_profiles: company_id = get_my_company_id()),
-- quindi con security_invoker=true l'utente autenticato vede i dati della propria azienda
-- esattamente come prima. Idempotente e parity-safe sui 3 tenant.
DO $$
BEGIN
  IF to_regclass('public.v_payables_operative') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.v_payables_operative SET (security_invoker = true)';
  END IF;
END $$;
