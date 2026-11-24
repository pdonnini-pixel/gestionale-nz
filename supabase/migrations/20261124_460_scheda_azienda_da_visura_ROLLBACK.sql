-- ROLLBACK della 460 · Scheda azienda dalla visura camerale
-- Toglie trigger e funzioni. Le colonne restano (contengono dati veri letti
-- dalla visura): si tolgono solo con conferma di Patrizio e backup.
BEGIN;
DROP TRIGGER IF EXISTS trg_company_settings_piva ON public.company_settings;
DROP TRIGGER IF EXISTS trg_company_settings_riempi_companies ON public.company_settings;
DROP FUNCTION IF EXISTS public.company_settings_piva_dell_azienda();
DROP FUNCTION IF EXISTS public.company_settings_riempi_companies();
-- Colonne (solo dopo backup e conferma):
-- ALTER TABLE public.company_settings DROP COLUMN amministratore_codice_fiscale,
--   DROP COLUMN visura_estratta_il, DROP COLUMN visura_documento_id,
--   DROP COLUMN visura_caricata_il, DROP COLUMN campi_da_visura;
-- ALTER TABLE public.outlets DROP COLUMN rea;
COMMIT;
