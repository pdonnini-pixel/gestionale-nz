-- ============================================================================
-- 460 · Scheda azienda dalla visura camerale (NZ + Zago)
-- ============================================================================
-- Patrizio, 24/11/2026: «tutte le informazioni della visura devono far parte
-- della scheda iniziale del singolo gestionale», e «prima hai sbagliato tra
-- partita di Zago e quella di New Zago».
--
-- 1. company_settings: campi che la visura dà e che mancavano
--    (CF dell'amministratore, data di estrazione della visura, documento
--    archiviato, provenienza dei campi scritti dal sistema).
-- 2. outlets.rea: il REA dell'unità locale (la visura lo dà per ogni negozio
--    fuori dalla provincia della sede).
-- 3. Guardia sulla P.IVA: company_settings.partita_iva non può diventare
--    diversa da companies.vat_number (la P.IVA con cui l'azienda è registrata
--    in A-Cube). È il blocco che impedisce di scrivere la P.IVA di Zago nel
--    gestionale di New Zago e il contrario, da qualunque parte arrivi.
-- 4. Allineamento verso companies: i campi VUOTI di companies (codice fiscale,
--    sede legale, PEC) si riempiono dalla scheda. Mai sovrascritti, e la P.IVA
--    di companies non si tocca mai da qui.
--
-- Solo aggiunte: nessun dato esistente cambia con questa migration.
-- ============================================================================
BEGIN;

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS amministratore_codice_fiscale text,
  ADD COLUMN IF NOT EXISTS visura_estratta_il date,
  ADD COLUMN IF NOT EXISTS visura_documento_id uuid,
  ADD COLUMN IF NOT EXISTS visura_caricata_il timestamptz,
  ADD COLUMN IF NOT EXISTS campi_da_visura jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.company_settings.amministratore_codice_fiscale IS
  'Codice fiscale del legale rappresentante, dalla visura camerale (migration 460).';
COMMENT ON COLUMN public.company_settings.visura_estratta_il IS
  'Data di estrazione della visura da cui vengono i dati (migration 460).';
COMMENT ON COLUMN public.company_settings.visura_documento_id IS
  'import_documents.id della visura archiviata (migration 460).';
COMMENT ON COLUMN public.company_settings.campi_da_visura IS
  'Campi scritti dal sistema leggendo la visura: {campo: data di estrazione}. Un campo modificato a mano esce da qui (migration 460).';

ALTER TABLE public.outlets
  ADD COLUMN IF NOT EXISTS rea text;

COMMENT ON COLUMN public.outlets.rea IS
  'Numero REA dell''unità locale, dalla visura camerale (migration 460).';

-- ── Guardia P.IVA ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.company_settings_piva_dell_azienda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_piva text;
  v_nuova text;
BEGIN
  v_nuova := nullif(regexp_replace(coalesce(NEW.partita_iva, ''), '[^0-9]', '', 'g'), '');
  IF v_nuova IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND v_nuova IS NOT DISTINCT FROM
     nullif(regexp_replace(coalesce(OLD.partita_iva, ''), '[^0-9]', '', 'g'), '') THEN
    RETURN NEW;
  END IF;
  SELECT nullif(regexp_replace(coalesce(c.vat_number, ''), '[^0-9]', '', 'g'), '')
    INTO v_piva
    FROM public.companies c
   WHERE c.id = NEW.company_id;
  IF v_piva IS NOT NULL AND v_piva <> v_nuova THEN
    RAISE EXCEPTION 'La P.IVA % non è quella di questa azienda (%): stai caricando i dati di un''altra società?', v_nuova, v_piva
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_settings_piva ON public.company_settings;
CREATE TRIGGER trg_company_settings_piva
  BEFORE INSERT OR UPDATE OF partita_iva ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.company_settings_piva_dell_azienda();

-- ── Allineamento dei campi vuoti di companies ──────────────────────────────
CREATE OR REPLACE FUNCTION public.company_settings_riempi_companies()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
END;
$$;

DROP TRIGGER IF EXISTS trg_company_settings_riempi_companies ON public.company_settings;
CREATE TRIGGER trg_company_settings_riempi_companies
  AFTER INSERT OR UPDATE OF codice_fiscale, sede_legale, pec ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.company_settings_riempi_companies();

-- Funzioni di trigger: non si chiamano dall'API.
REVOKE ALL ON FUNCTION public.company_settings_piva_dell_azienda() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.company_settings_riempi_companies() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Verifica:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='company_settings'
--    AND column_name IN ('amministratore_codice_fiscale','visura_estratta_il','visura_documento_id','visura_caricata_il','campi_da_visura');
-- SELECT tgname FROM pg_trigger WHERE tgrelid='public.company_settings'::regclass AND NOT tgisinternal;
