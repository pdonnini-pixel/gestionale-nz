-- ============================================================================
-- ZAGO_ONLY 462 · Dati di Zago dalla visura camerale del 22/04/2026
-- ============================================================================
-- Fonte: «Visura Zago apr 2026.pdf» (06719450485-VISUORD-20260422), Drive →
-- DOCUMENTI PER GESTIONALI, documento n. ZG0RZNGEPBLFVCM4PB.
-- Decisioni di Patrizio (24/11/2026): «procedi con tutto», «togli Reggello da
-- Zago». La visura di Zago ha due unità locali (Firenze Via del Corso e Forte
-- dei Marmi): il magazzino di Pian di Rona è un'unità locale di New Zago.
--
-- Cosa cambia (valori di prima nel ROLLBACK):
--   company_settings: forma giuridica, REA, capitale, costituzione, PEC, ATECO,
--     amministratore e suo CF, soci con codice fiscale (prima vuoti).
--   outlets: REA di Forte dei Marmi; «Sede / Magazzino» di Reggello spento
--     (is_active = false, niente DELETE): nessun dipendente, costo o riparto
--     lo usa; tre fatture Tanesini che lo nominavano tornano al calcolo
--     automatico del negozio al prossimo ricalcolo.
-- ============================================================================
DO $$
DECLARE
  v_company uuid;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE vat_number = '06719450485' LIMIT 1;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Azienda Zago (P.IVA 06719450485) non trovata: migration solo Zago';
  END IF;

  UPDATE public.company_settings SET
    forma_giuridica = 'Società a responsabilità limitata',
    rea = 'FI-650808',
    capitale_sociale = '€ 10.000,00 i.v.',
    data_costituzione = '01/03/2017',
    pec = 'zagosrlfirenze@legalmail.it',
    ateco = '47.71 – Commercio al dettaglio di articoli di abbigliamento',
    amministratore = 'GALLO MASSIMO (Amministratore Unico)',
    amministratore_codice_fiscale = 'GLLMSM72S12D612X',
    soci = '[{"nome":"AMERICAN T-SHIRT S.R.L.","quota":"55%","ruolo":"Socio di maggioranza","codice_fiscale":"02278740283"},{"nome":"PAMA DI GALLO MASSIMO & C. S.A.S.","quota":"45%","ruolo":"Socio","codice_fiscale":"04533840486"}]'::jsonb,
    visura_estratta_il = DATE '2026-04-22',
    campi_da_visura = '{"forma_giuridica":"2026-04-22","rea":"2026-04-22","capitale_sociale":"2026-04-22","data_costituzione":"2026-04-22","pec":"2026-04-22","ateco":"2026-04-22","amministratore":"2026-04-22","amministratore_codice_fiscale":"2026-04-22","soci":"2026-04-22","sede_legale":"2026-04-22","partita_iva":"2026-04-22","codice_fiscale":"2026-04-22"}'::jsonb,
    updated_at = now()
  WHERE company_id = v_company;

  UPDATE public.outlets SET rea = 'LU-227768',
    notes = coalesce(notes || E'\n', '') || '24/11/2026: REA dell''unità locale dalla visura camerale del 22/04/2026.'
  WHERE company_id = v_company AND code = 'ZAGO-FDM';

  UPDATE public.outlets SET is_active = false,
    notes = coalesce(notes || E'\n', '') || '24/11/2026: spento su indicazione di Patrizio («togli Reggello da Zago»). Nella visura di Zago del 22/04/2026 non c''è: il magazzino di Pian di Rona è un''unità locale di New Zago.'
  WHERE company_id = v_company AND code = 'ZAGO-SEDE' AND is_active;
END $$;
