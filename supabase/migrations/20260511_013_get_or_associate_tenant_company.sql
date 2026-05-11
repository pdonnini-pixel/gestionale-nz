-- Migrazione 013 — get_or_associate_tenant_company RPC
--
-- Bug noto pre-013: useOnboardingStatus faceva SELECT diretta su `companies`
-- con RLS. Per un utente con `user_profiles.company_id = NULL`, la policy
-- SELECT su companies (`id = get_my_company_id()`) ritorna 0 righe → il
-- frontend interpretava "tenant vergine" e reindirizzava al wizard.
-- Risultato: ogni nuovo utente di un tenant già onboardato veniva costretto
-- al wizard, anche se il tenant aveva già una company.
--
-- Fix: RPC SECURITY DEFINER che bypassa RLS in modo controllato:
--   - se utente ha già company_id → ritorna quello
--   - se utente senza company_id MA tenant ha company → auto-associa
--   - se tenant vergine (zero companies) → ritorna NULL → frontend mostra wizard
--
-- Questa è la versione single-company-per-tenant del design ADR-001:
-- ogni tenant Supabase ospita esattamente una company, quindi un utente
-- nuovo di quel tenant deve essere associato a quella company unica.

CREATE OR REPLACE FUNCTION public.get_or_associate_tenant_company()
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_existing_cid uuid;
  v_company_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'utente non autenticato' USING ERRCODE = '28000';
  END IF;

  SELECT company_id INTO v_existing_cid
    FROM public.user_profiles WHERE id = v_user_id;

  IF v_existing_cid IS NOT NULL THEN
    RETURN v_existing_cid;
  END IF;

  SELECT id INTO v_company_id FROM public.companies LIMIT 1;

  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.user_profiles
    SET company_id = v_company_id, updated_at = now()
    WHERE id = v_user_id;

  RETURN v_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_associate_tenant_company() TO authenticated;
