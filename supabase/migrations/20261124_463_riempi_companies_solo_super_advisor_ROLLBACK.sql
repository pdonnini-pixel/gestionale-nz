-- ROLLBACK 463: torna alla versione della 460 (riempie companies per chiunque scriva la scheda).
CREATE OR REPLACE FUNCTION public.company_settings_riempi_companies()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.companies c
     SET fiscal_code   = coalesce(nullif(c.fiscal_code, ''), nullif(NEW.codice_fiscale, '')),
         legal_address = coalesce(nullif(c.legal_address, ''), nullif(NEW.sede_legale, '')),
         pec           = coalesce(nullif(c.pec, ''), nullif(NEW.pec, ''))
   WHERE c.id = NEW.company_id
     AND (  (nullif(c.fiscal_code, '') IS NULL AND nullif(NEW.codice_fiscale, '') IS NOT NULL)
         OR (nullif(c.legal_address, '') IS NULL AND nullif(NEW.sede_legale, '') IS NOT NULL)
         OR (nullif(c.pec, '') IS NULL AND nullif(NEW.pec, '') IS NOT NULL));
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.company_settings_riempi_companies() FROM PUBLIC, anon, authenticated;
