-- ROLLBACK NZ_ONLY 461: rimette i valori di prima (backup del 24/11/2026).
-- Le note aggiunte agli outlet restano: sono storico, non dati di calcolo.
-- Dal backup: indirizzo, CAP, provincia e REA dei sei negozi erano tutti NULL;
-- capitale_sociale («€ 10.000,00 i.v.») e forma_giuridica («Società a
-- responsabilità limitata») avevano già il valore che la 461 riscrive, quindi
-- qui non si toccano.
DO $$
DECLARE v_company uuid;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE vat_number = '07362100484' LIMIT 1;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Rollback solo NZ'; END IF;

  UPDATE public.company_settings SET
    codice_fiscale = '07XXXXXXXXX', rea = 'FI-XXXXXX', pec = 'newzago@pec.it', codice_sdi = 'XXXXXXX',
    data_costituzione = '2024', ateco = '47.71.10 – Commercio al dettaglio di abbigliamento',
    amministratore = 'Ferretti Fabio (Amministratore Unico)', amministratore_codice_fiscale = NULL,
    soci = '[{"nome":"AMERICAN T-SHIRT S.R.L.","quota":"55%","ruolo":"Socio di maggioranza"},{"nome":"PAMA S.R.L.","quota":"45%","ruolo":"Socio"}]'::jsonb,
    visura_estratta_il = NULL, campi_da_visura = '{}'::jsonb
  WHERE company_id = v_company;

  UPDATE public.outlets SET address = NULL, cap = NULL, province = NULL, rea = NULL
   WHERE company_id = v_company AND code IN ('BRB','VDC','FRC','VLM','BRG','PLM');
  UPDATE public.outlets SET opening_date = DATE '2025-03-17' WHERE company_id = v_company AND code = 'BRB';
  UPDATE public.outlets SET opening_date = DATE '2024-01-01' WHERE company_id = v_company AND code = 'VDC';
END $$;
