-- ============================================================================
-- NZ_ONLY 461 · Dati di New Zago dalla visura camerale del 22/04/2026
-- ============================================================================
-- Fonte: «Visura New Zago srl Aprile 2026.pdf», Drive → DOCUMENTI PER GESTIONALI,
-- documento n. ZG0RZNGEP68Y6Y4XL5 estratto il 22/04/2026.
-- Decisioni di Patrizio (24/11/2026): «procedi con tutto», il magazzino si
-- scrive «Pian di Rona» (la visura dice «Pian di Roma»), l'ufficio-magazzino
-- di Figline e Incisa Valdarno è quello vecchio e non esiste più (non si crea).
--
-- Cosa cambia (valori di prima nel ROLLBACK):
--   company_settings: CF, REA, PEC, data di costituzione, ATECO, amministratore
--     e suo CF, soci con codice fiscale; il codice SDI segnaposto «XXXXXXX»
--     torna vuoto (la visura non lo riporta).
--   outlets: indirizzo, CAP, provincia e REA dei sei negozi in visura; data di
--     apertura di Valdichiana (01/01/2024 → 13/06/2024) e Barberino
--     (17/03/2025 → 26/03/2025) come in visura. Nota datata in coda.
-- Torino e Roma Soratte non sono in questa visura (aperti dopo): invariati.
-- ============================================================================
DO $$
DECLARE
  v_company uuid;
  v_nota text := '24/11/2026: dati dalla visura camerale del 22/04/2026 (Patrizio).';
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE vat_number = '07362100484' LIMIT 1;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Azienda New Zago (P.IVA 07362100484) non trovata: migration solo NZ';
  END IF;

  UPDATE public.company_settings SET
    codice_fiscale = '07362100484',
    rea = 'FI-698232',
    pec = 'newzago@legalmail.it',
    codice_sdi = NULL,
    data_costituzione = '17/04/2024',
    capitale_sociale = '€ 10.000,00 i.v.',
    forma_giuridica = 'Società a responsabilità limitata',
    ateco = '47.71.10 – Commercio al dettaglio di articoli di abbigliamento per adulti',
    amministratore = 'GALLO MASSIMO (Amministratore Unico)',
    -- amministratore_codice_fiscale: scritto a parte (dato personale, il repository è pubblico)
    soci = '[{"nome":"AMERICAN T-SHIRT S.R.L.","quota":"55%","ruolo":"Socio di maggioranza","codice_fiscale":"02278740283"},{"nome":"PAMA DI GALLO MASSIMO & C. S.A.S.","quota":"45%","ruolo":"Socio","codice_fiscale":"04533840486"}]'::jsonb,
    visura_estratta_il = DATE '2026-04-22',
    campi_da_visura = '{"codice_fiscale":"2026-04-22","rea":"2026-04-22","pec":"2026-04-22","data_costituzione":"2026-04-22","capitale_sociale":"2026-04-22","forma_giuridica":"2026-04-22","ateco":"2026-04-22","amministratore":"2026-04-22","amministratore_codice_fiscale":"2026-04-22","soci":"2026-04-22","sede_legale":"2026-04-22","partita_iva":"2026-04-22","ragione_sociale":"2026-04-22"}'::jsonb,
    updated_at = now()
  WHERE company_id = v_company;

  UPDATE public.outlets SET address = 'Via Meucci 31', cap = '50031', province = 'FI',
    opening_date = DATE '2025-03-26',
    notes = coalesce(notes || E'\n', '') || v_nota || ' Apertura 26/03/2025 come in visura (prima 17/03/2025).'
  WHERE company_id = v_company AND code = 'BRB';

  UPDATE public.outlets SET address = 'Via Enzo Ferrari 5', cap = '52045', province = 'AR', rea = 'AR-220128',
    opening_date = DATE '2024-06-13',
    notes = coalesce(notes || E'\n', '') || v_nota || ' Apertura 13/06/2024 come in visura (prima 01/01/2024).'
  WHERE company_id = v_company AND code = 'VDC';

  UPDATE public.outlets SET address = 'Via Giovan Battista Moroni 3', cap = '25050', province = 'BS', rea = 'BS-632967',
    notes = coalesce(notes || E'\n', '') || v_nota
  WHERE company_id = v_company AND code = 'FRC';

  UPDATE public.outlets SET address = 'Via della Pace snc, c/o Valmontone Outlet', cap = '00038', province = 'RM', rea = 'RM-1772743',
    notes = coalesce(notes || E'\n', '') || v_nota
  WHERE company_id = v_company AND code = 'VLM';

  UPDATE public.outlets SET address = 'Via Nuova Antica Romana snc', cap = '19020', province = 'SP', rea = 'SP-245852',
    notes = coalesce(notes || E'\n', '') || v_nota
  WHERE company_id = v_company AND code = 'BRG';

  UPDATE public.outlets SET address = 'Strada Provinciale 126', cap = '33041', province = 'UD', rea = 'UD-376651',
    notes = coalesce(notes || E'\n', '') || v_nota
  WHERE company_id = v_company AND code = 'PLM';
END $$;
