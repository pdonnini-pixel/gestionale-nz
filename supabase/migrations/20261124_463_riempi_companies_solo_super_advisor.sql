-- ============================================================================
-- 463 · Il riempimento di companies dalla scheda azienda solo per chi può
--       scrivere companies (NZ + Zago)
-- ============================================================================
-- Revisore di sicurezza sulla 460: il trigger SECURITY DEFINER copiava in
-- companies i campi vuoti scritti in company_settings anche quando a scrivere
-- era un contabile, che companies non può aggiornare (policy companies_update:
-- solo super_advisor). Ora copia solo se scrive il super_advisor oppure se la
-- scrittura non viene da un utente (migration, service role: auth.uid() nullo).
-- Nessun dato cambia con questa migration.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.company_settings_riempi_companies()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL
     AND coalesce((SELECT public.get_my_role())::text, '') <> 'super_advisor' THEN
    RETURN NEW;
  END IF;
  UPDATE public.companies c
     SET fiscal_code   = coalesce(nullif(c.fiscal_code, ''), nullif(NEW.codice_fiscale, '')),
         legal_address = coalesce(nullif(c.legal_address, ''), nullif(NEW.sede_legale, '')),
         pec           = coalesce(nullif(c.pec, ''), nullif(NEW.pec, ''))
   WHERE c.id = NEW.company_id
     AND (  (nullif(c.fiscal_code, '') IS NULL AND nullif(NEW.codice_fiscale, '') IS NOT NULL)
         OR (nullif(c.legal_address, '') IS NULL AND nullif(NEW.sede_legale, '') IS NOT NULL)
         OR (nullif(c.pec, '') IS NULL AND nullif(NEW.pec, '') IS NOT NULL));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.company_settings_riempi_companies() FROM PUBLIC, anon, authenticated;
