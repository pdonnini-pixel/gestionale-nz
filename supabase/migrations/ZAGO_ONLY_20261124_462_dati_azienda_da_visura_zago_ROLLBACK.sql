-- ROLLBACK ZAGO_ONLY 462: rimette i valori di prima (backup del 24/11/2026).
DO $$
DECLARE v_company uuid;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE vat_number = '06719450485' LIMIT 1;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Rollback solo Zago'; END IF;

  UPDATE public.company_settings SET
    forma_giuridica = NULL, rea = NULL, capitale_sociale = NULL, data_costituzione = NULL, pec = NULL,
    ateco = NULL, amministratore = NULL, amministratore_codice_fiscale = NULL, soci = '[]'::jsonb,
    visura_estratta_il = NULL, campi_da_visura = '{}'::jsonb
  WHERE company_id = v_company;

  UPDATE public.outlets SET rea = NULL WHERE company_id = v_company AND code = 'ZAGO-FDM';
  UPDATE public.outlets SET is_active = true WHERE company_id = v_company AND code = 'ZAGO-SEDE';
END $$;
