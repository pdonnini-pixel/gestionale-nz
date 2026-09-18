-- ─────────────────────────────────────────────────────────────────────────────
-- NZ_ONLY 20260918_238 — Contratto di locazione del magazzino di Reggello (FI),
-- località Pian di Rona 120/B, conduttrice New Zago S.r.l., locatrice Alfatecno
-- S.r.l. Solo New Zago: è un DATO del tenant, non schema (la parità #0 vale per
-- codice e migration di schema).
--
-- Fonte: fascicolo «registrazionecontrattocapannone» del 18/09/2026, cinque PDF:
--   1. Contratto di locazione immobili ad uso commerciale (L. 392/1978), 7 pagine,
--      firmato a Figline e Incisa Valdarno il 05/02/2026;
--   2. Ricevuta di registrazione Entratel del 09/02/2026 (n. 003665 serie 3T,
--      codice identificativo TZM26T003665000ZH, ufficio di Firenze);
--   3. Planimetria catastale (foglio 110, particella 184, subalterno 504);
--   4. APE 0000745140, classe G, valido fino al 23/04/2034;
--   5. Certificazione notarile di copia conforme (rep. 9913, notaio Valia).
-- Analisi completa in MAGAZZINO_REGGELLO_NOTES.md.
--
-- Cosa fa (solo INSERT/UPDATE, nessuna cancellazione, idempotente):
--   1. fornitore Alfatecno (aggancio per P.IVA 03916460482): centro di costo
--      sede/magazzino, piano di pagamento dai termini del contratto, note;
--   2. scheda outlet SEDE / MAGAZZINO: immobile, catasto, durata, deposito;
--   3. contratto in `contracts` con rivalutazione ISTAT al 75% e disdetta;
--   4. storico canoni: 500 → 2.500 → 3.200 al mese;
--   5. nove scadenze contrattuali, dalla rivalutazione alla disdetta;
--   6. un costo ricorrente di 3.050 € lordi al mese, così Scadenzario e Cashflow
--      vedono il canone anche nei mesi in cui la fattura non è ancora arrivata;
--   7. checklist dei sei documenti del fascicolo, da caricare dalla scheda
--      outlet (tab Documenti): i file non passano da qui;
--   8. imposta di registro della seconda annualità fra le scadenze fiscali.
--
-- ATTENZIONE — `outlets.rent_monthly` resta VUOTO di proposito: il Cashflow
-- Prospettico somma `uscite_canoni` (da rent_monthly) e `uscite_ricorrenti` (da
-- recurring_costs) senza confrontarle, quindi valorizzare tutti e due conterebbe
-- il canone due volte. Qui il canone sta nel costo ricorrente, che in più si
-- azzera da solo quando arriva la fattura vera (copertura per fornitore+mese
-- entro l'8% in ScadenzarioSmart).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  v_company   uuid;
  v_outlet    uuid;
  v_alfatecno uuid;
  v_loc       uuid;   -- cost_categories LOC_OUTLET
  v_contract  uuid;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE vat_number = '07362100484' LIMIT 1;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Azienda New Zago (P.IVA 07362100484) non trovata: migration solo NZ';
  END IF;

  SELECT id INTO v_outlet FROM public.outlets WHERE company_id = v_company AND code = 'SED' LIMIT 1;
  IF v_outlet IS NULL THEN
    RAISE EXCEPTION 'Outlet SEDE / MAGAZZINO (SED) non trovato';
  END IF;

  SELECT id INTO v_loc FROM public.cost_categories WHERE company_id = v_company AND code = 'LOC_OUTLET' LIMIT 1;

  -- ── 1. Fornitore Alfatecno (aggancio per P.IVA, mai per nome) ────────────
  SELECT id INTO v_alfatecno FROM public.suppliers
   WHERE company_id = v_company AND (partita_iva = '03916460482' OR vat_number = '03916460482')
   LIMIT 1;
  IF v_alfatecno IS NULL THEN
    INSERT INTO public.suppliers (company_id, name, ragione_sociale, slug, category, is_active, is_deleted, source, nazione,
                                  partita_iva, vat_number, codice_fiscale, fiscal_code,
                                  indirizzo, citta, comune, cap, provincia)
    VALUES (v_company, 'ALFATECNO S.R.L.', 'ALFATECNO S.R.L.', 'alfatecno-srl', 'Affitti', true, false, 'manual', 'IT',
            '03916460482', '03916460482', '03916460482', '03916460482',
            'VIA STRASBURGO 9', 'Figline Valdarno', 'Figline Valdarno', '50063', 'FI')
    RETURNING id INTO v_alfatecno;
  END IF;

  UPDATE public.suppliers SET
    ragione_sociale          = COALESCE(NULLIF(ragione_sociale, ''), 'ALFATECNO S.R.L.'),
    indirizzo                = COALESCE(NULLIF(indirizzo, ''), 'VIA STRASBURGO 9'),
    citta                    = COALESCE(NULLIF(citta, ''), 'Figline Valdarno'),
    comune                   = COALESCE(NULLIF(comune, ''), 'Figline Valdarno'),
    cap                      = COALESCE(NULLIF(cap, ''), '50063'),
    provincia                = COALESCE(NULLIF(provincia, ''), 'FI'),
    category                 = CASE WHEN category IS NULL OR category IN ('fornitore', 'Altro') THEN 'Affitti' ELSE category END,
    default_cost_category_id = COALESCE(default_cost_category_id, v_loc),
    -- Il costo è tutto della sede/magazzino, non da ripartire sugli outlet.
    cost_center              = 'sede_magazzino',
    -- Piano dal DOCUMENTO (art. III: canone mensile anticipato entro il 10 del
    -- mese), non più il ripiego «fine mese 30 giorni» scritto dal profilo
    -- automatico. Coerente con le tre fatture già ricevute, che scadono il
    -- giorno stesso dell'emissione.
    payment_base             = 'data_fattura',
    prima_scadenza_gg        = 0,
    numero_rate              = 1,
    payment_terms            = 0,
    default_payment_terms    = 0,
    payment_method           = COALESCE(payment_method, 'bonifico_ordinario'),
    default_payment_method   = COALESCE(default_payment_method, 'bonifico_ordinario'),
    note = COALESCE(NULLIF(note, ''), '') ||
      E'\nLocatrice del magazzino di Reggello (FI), località Pian di Rona 120/B. Contratto del 05/02/2026 (L. 392/1978, uso commerciale): canone mensile anticipato entro il 10 di ogni mese a mezzo bonifico, IVA per opzione (art. 10 c.1 n.8 DPR 633/72). 500 €/mese fino al 04/07/2026 (pagati in unica soluzione con assegno alla firma), 2.500 €/mese fino al 04/12/2028, 3.200 €/mese dopo. Deposito cauzionale 9.600 € già versato con assegno.',
    updated_at = now()
  WHERE id = v_alfatecno;

  -- ── 2. Scheda outlet SEDE / MAGAZZINO ────────────────────────────────────
  UPDATE public.outlets SET
    address                  = COALESCE(NULLIF(address, ''), 'Località Pian di Rona 120/B'),
    city                     = COALESCE(NULLIF(city, ''), 'Reggello'),
    province                 = COALESCE(NULLIF(province, ''), 'FI'),
    region                   = COALESCE(NULLIF(region, ''), 'Toscana'),
    cap                      = COALESCE(NULLIF(cap, ''), '50066'),
    -- Superficie utile riscaldata da APE 0000745140 (805,3 mq, H 6,50 m).
    sqm                      = COALESCE(sqm, 805.3),
    concedente               = COALESCE(NULLIF(concedente, ''), 'ALFATECNO S.R.L.'),
    landlord_supplier_id     = COALESCE(landlord_supplier_id, v_alfatecno),
    contract_start           = COALESCE(contract_start, DATE '2026-02-05'),
    contract_end             = COALESCE(contract_end, DATE '2032-02-04'),
    contract_duration_months = COALESCE(contract_duration_months, 72),
    contract_min_months      = COALESCE(contract_min_months, 34),
    rent_start_date          = COALESCE(rent_start_date, DATE '2026-02-05'),
    -- Canone dell'annualità in corso (2.500 €/mese × 12). rent_monthly resta
    -- vuoto: vedi la nota in testa al file (doppio conteggio nel Cashflow).
    rent_annual              = COALESCE(rent_annual, 30000),
    deposit_amount           = COALESCE(deposit_amount, 9600),
    notes = COALESCE(NULLIF(notes, ''), '') ||
      E'Magazzino in locazione a Reggello (FI), località Pian di Rona 120/B: catasto foglio 110, particella 184, subalterno 504, categoria D/07, rendita 6.040 €. Capannone del 2002, superficie utile 805,3 mq, altezza 6,50 m, con resede esclusivo e area verde retrostante. Classe energetica G (APE 0000745140, valido fino al 23/04/2034).\n'
      || E'Locatrice Alfatecno S.r.l. Contratto firmato il 05/02/2026, registrato il 09/02/2026 (n. 003665 serie 3T, codice TZM26T003665000ZH, ufficio di Firenze). Durata 6 anni fino al 04/02/2032, rinnovo tacito di altri 6 salvo disdetta 12 mesi prima.\n'
      || E'Canone: 500 €/mese dal 05/02 al 04/07/2026 (2.500 € pagati in anticipo con assegno alla firma, sconto concesso a fronte dei lavori di adeguamento), 2.500 €/mese + IVA fino al 04/12/2028, poi 3.200 €/mese + IVA (canone pieno 38.400 €/anno). Rivalutazione ISTAT al 75% ogni anno dal terzo. Pagamento anticipato entro il 10 del mese.\n'
      || E'Deposito cauzionale 9.600 €. A nostro carico: utenze (volturate a nostro nome), TARI, passo carrabile, manutenzione ordinaria, area verde, polizza RC per tutta la durata. Uso esclusivo di magazzino: cambio di destinazione vietato senza consenso scritto.\n'
      || E'Il campo «canone mensile» della scheda resta vuoto di proposito: il canone è registrato come costo ricorrente (Scadenzario → Ricorrenze), altrimenti il Cashflow lo conterebbe due volte.',
    updated_at = now()
  WHERE id = v_outlet;

  -- ── 3. Contratto ─────────────────────────────────────────────────────────
  SELECT id INTO v_contract FROM public.contracts
   WHERE company_id = v_company AND contract_number = 'TZM26T003665000ZH' LIMIT 1;

  IF v_contract IS NULL THEN
    INSERT INTO public.contracts (
      company_id, outlet_id, name, contract_type, counterpart, contract_number, cost_category_id,
      monthly_amount, annual_amount, vat_rate, deposit_amount,
      start_date, end_date, renewal_date, notice_days, notice_deadline,
      auto_renewal, renewal_period_months,
      escalation_type, escalation_rate, escalation_date, escalation_frequency_months,
      sqm, status, notes
    ) VALUES (
      v_company, v_outlet, 'Locazione magazzino Pian di Rona 120/B — Reggello (FI)', 'locazione_commerciale',
      'ALFATECNO S.R.L.', 'TZM26T003665000ZH', v_loc,
      -- Canone dell'annualità in corso, al netto dell'IVA.
      2500, 30000, 22, 9600,
      DATE '2026-02-05', DATE '2032-02-04', DATE '2032-02-05', 365, DATE '2031-02-04',
      true, 72,
      -- escalation_rate è una frazione: 0.75 = 75% della variazione ISTAT.
      'istat_75pct', 0.75, DATE '2028-02-05', 12,
      805.3, 'attivo',
      E'Contratto di locazione di immobile ad uso commerciale (L. 392/1978) firmato il 05/02/2026 a Figline e Incisa Valdarno, registrato il 09/02/2026 all''ufficio di Firenze al n. 003665 serie 3T (codice identificativo TZM26T003665000ZH), tipologia S2 immobile strumentale.\n'
      || E'Art. III — canone pieno 38.400 €/anno + IVA (3.200 €/mese). Scaletta concordata a fronte dei lavori dell''art. VI: 500 €/mese dal 05/02 al 04/07/2026 (2.500 € versati in unica soluzione con assegno MPS 0960961934-10 alla firma), 2.500 €/mese + IVA dal 05/07/2026 al 04/12/2028, 3.200 €/mese + IVA dal 05/12/2028. Pagamento anticipato con bonifico entro il 10 di ogni mese. Rivalutazione dal terzo anno pari al 75% della variazione ISTAT dell''anno precedente (art. 32 L. 392/78).\n'
      || E'Art. II — durata 6 anni dal 05/02/2026 al 04/02/2032, prorogabili di 6 anni fino al 04/02/2038; rinnovo tacito di sei anni in sei anni salvo disdetta con raccomandata a/r almeno 12 mesi prima. Recesso della conduttrice con preavviso di 6 mesi, ma nei primi 34 mesi (fino al 05/12/2028) solo per gravi motivi.\n'
      || E'Art. IV — a carico nostro utenze (voltura entro 30 giorni dalla firma), passo carrabile, rifiuti, manutenzione ordinaria (art. 1609 c.c.), riscaldamento e condizionamento, manutenzione dell''area verde retrostante (allegato B).\n'
      || E'Art. VI — opere a nostra cura e spese entro 4 mesi dalla firma: pareti REI verso i subalterni 505/506/507 con SCIA, zona ufficio con due split, messa in sicurezza di infissi e portelloni, verifica della messa a terra, migliorie all''illuminazione, automazione del lucernario di evacuazione fumi, rete divisoria nel piazzale. Se non completate, la locatrice può pretendere il canone pieno di 3.200 €/mese anche per i mesi scontati, al netto di quanto già pagato. Le opere restano all''immobile senza indennizzo.\n'
      || E'Art. VII — deposito cauzionale 9.600 € versato con assegno, non imputabile a canoni, produttivo di interessi. Obbligo di polizza per danni a terzi e cose entro 15 giorni dall''inizio dell''attività, per tutta la durata della locazione. La mancata polizza, come il mancato pagamento del canone, il cambio di destinazione e i lavori non autorizzati, comporta la risoluzione di diritto (art. XIII).\n'
      || E'Art. XI — opzione per l''imponibilità IVA (art. 10 c.1 n.8 DPR 633/72); spese di registrazione, imposta di registro e bollo divise a metà con la locatrice, che si occupa della registrazione (art. XIV). Foro di Firenze.\n'
      || E'Da verificare col commercialista: la registrazione dichiara un canone di 17.500 € per la prima annualità (registro 175 € = 1%), mentre la scaletta dell''art. III per il periodo 05/02/2026-04/02/2027 vale 20.000 € (5 mesi a 500 + 7 mesi a 2.500).'
    ) RETURNING id INTO v_contract;

    -- ── 4. Storico canoni (importi annui) ──────────────────────────────────
    INSERT INTO public.contract_amount_history (contract_id, effective_date, previous_amount, new_amount, reason) VALUES
      (v_contract, DATE '2026-02-05', NULL,  6000, 'Canone ridotto 500 €/mese dal 05/02 al 04/07/2026 (art. III): 2.500 € per i cinque mesi, pagati in anticipo con assegno alla firma.'),
      (v_contract, DATE '2026-07-05', 6000,  30000, 'Canone 2.500 €/mese + IVA dal 05/07/2026 al 04/12/2028 (art. III), anticipato entro il 10 del mese.'),
      (v_contract, DATE '2028-12-05', 30000, 38400, 'Canone pieno 3.200 €/mese + IVA dal 05/12/2028 (art. III), da rivalutare con l''ISTAT al 75% maturato dal terzo anno.');

    -- ── 5. Scadenze contrattuali ───────────────────────────────────────────
    INSERT INTO public.contract_deadlines (contract_id, deadline_date, description, notes) VALUES
      (v_contract, DATE '2026-06-05', 'Termine per completare le opere di adeguamento (4 mesi dalla firma)', 'Art. VI: pareti REI, zona ufficio con due split, infissi e portelloni, messa a terra, illuminazione, lucernario, rete divisoria del piazzale. Se non completate, la locatrice può chiedere il canone pieno di 3.200 €/mese anche per i mesi scontati.'),
      (v_contract, DATE '2027-03-06', 'Imposta di registro della seconda annualità (30 giorni dal 04/02/2027)', 'Art. XI: 1% del canone annuo, diviso a metà con la locatrice, che versa e riaddebita. Vedi la scadenza fiscale collegata.'),
      (v_contract, DATE '2028-02-05', 'Prima rivalutazione ISTAT del canone (75% della variazione dell''anno precedente)', 'Art. III e art. 32 L. 392/78: si applica dal terzo anno di contratto, poi ogni anno alla stessa data. Aggiornare il costo ricorrente.'),
      (v_contract, DATE '2028-12-05', 'Canone pieno 3.200 €/mese + IVA: aggiornare il costo ricorrente e la scheda outlet', 'Art. III: fine del periodo agevolato. Il costo ricorrente passa da 3.050 a 3.904 € lordi al mese (3.200 + IVA 22%), più l''ISTAT maturato.'),
      (v_contract, DATE '2028-12-05', 'Torna la facoltà di recesso libero con preavviso di 6 mesi', 'Art. II: scaduti i primi 34 mesi, il recesso non richiede più i gravi motivi. Raccomandata a/r o PEC.'),
      (v_contract, DATE '2031-02-04', 'Ultimo giorno utile per la disdetta, per evitare il rinnovo tacito di 6 anni', 'Art. II: raccomandata a/r almeno 12 mesi prima della scadenza del 04/02/2032. Senza disdetta il contratto prosegue fino al 04/02/2038.'),
      (v_contract, DATE '2032-02-04', 'Prima scadenza del contratto', 'Art. II: in mancanza di disdetta si rinnova tacitamente di sei anni, fino al 04/02/2038.'),
      (v_contract, DATE '2034-04-23', 'Scadenza dell''APE dell''immobile (0000745140, classe G)', 'A carico della proprietà, ma da richiedere per il fascicolo del magazzino.'),
      (v_contract, DATE '2038-02-04', 'Scadenza della proroga di sei anni', 'Art. II: termine finale previsto dal contratto in caso di rinnovo.');
  END IF;

  -- ── 6. Costo ricorrente: il canone mensile ───────────────────────────────
  -- Importo LORDO (2.500 + IVA 22% = 3.050): il Cashflow ragiona di cassa e lo
  -- Scadenzario confronta la stima con il lordo della fattura vera, che è
  -- esattamente 3.050 nelle tre già ricevute (28/02, 23/07, 26/08).
  INSERT INTO public.recurring_costs (company_id, cost_center, cost_category_id, description, amount,
                                      frequency, day_of_month, month_start, start_date, payment_method,
                                      supplier_name, is_active, notes)
  SELECT v_company, 'sede_magazzino', v_loc, 'Canone magazzino Reggello (Pian di Rona 120/B)', 3050,
         'monthly', 10, 7, DATE '2026-07-05', 'bonifico_ordinario',
         'ALFATECNO S.R.L.', true,
         'Contratto del 05/02/2026 art. III: 2.500 € + IVA al mese, anticipati con bonifico entro il 10, dal 05/07/2026 al 04/12/2028. Importo lordo, perché il confronto con la fattura vera e il cashflow ragionano di cassa. Dal 05/12/2028 diventa 3.200 + IVA = 3.904 €, più la rivalutazione ISTAT al 75% che matura dal terzo anno. La stima sparisce da sola nei mesi in cui è già arrivata la fattura di Alfatecno.'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.recurring_costs
     WHERE company_id = v_company AND cost_center = 'sede_magazzino'
       AND description LIKE 'Canone magazzino Reggello%');

  -- ── 7. Checklist del fascicolo (i file si caricano dalla scheda outlet) ──
  INSERT INTO public.outlet_attachments (company_id, outlet_id, attachment_type, label, is_required, is_uploaded, notes)
  SELECT v_company, v_outlet, t.tipo, t.label, t.obbligatorio, false, t.note
  FROM (VALUES
    ('contratto_locazione', 'Contratto di locazione magazzino Reggello — firmato 05/02/2026', true,  'PDF scansionato di 7 pagine («Contratto Magazzino.pdf»), firmato da entrambe le parti in ogni pagina.'),
    ('registrazione',       'Ricevuta di registrazione Entratel — 09/02/2026', true,  'Registrazione n. 003665 serie 3T, codice TZM26T003665000ZH, ufficio di Firenze. Imposte: registro 175 € + bollo 64 € = 239 €, prima annualità, divisi a metà con la locatrice.'),
    ('planimetria',         'Planimetria catastale — allegato A', true,  'Catasto Fabbricati di Reggello: foglio 110, particella 184, subalterno 504, scala 1:500, magazzino H 6,50 m con resede esclusivo.'),
    ('ape',                 'APE 0000745140 — classe G, valido fino al 23/04/2034', true,  'Attestato di prestazione energetica: superficie utile riscaldata 805,3 mq, volume lordo 6.022,58 m³, EP globale 307,5 kWh/m²anno, edificio del 2002, zona climatica E.'),
    ('copia_conforme',      'Certificazione notarile di copia conforme dell''APE', false, 'Rep. 9913 del notaio Caterina Valia (Firenze), 29/04/2024: copia conforme dell''originale informatico firmato dall''architetto Audero.'),
    ('polizza_rc',          'Polizza RC per danni a terzi e cose (obbligo di contratto)', true,  'Art. VII: da stipulare entro 15 giorni dall''inizio dell''attività e da tenere per tutta la durata della locazione. La mancanza comporta la risoluzione di diritto (art. XIII). Caricare la polizza in corso.')
  ) AS t(tipo, label, obbligatorio, note)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.outlet_attachments a
     WHERE a.outlet_id = v_outlet AND a.attachment_type = t.tipo);

  -- ── 8. Imposta di registro della seconda annualità ───────────────────────
  INSERT INTO public.fiscal_deadlines (company_id, deadline_type, title, description, amount, due_date, status, is_recurring, recurrence_rule, notes)
  SELECT v_company, 'altro', 'Imposta di registro magazzino Reggello — seconda annualità',
    'Contratto TZM26T003665000ZH, locazione soggetta a IVA per opzione: imposta di registro annuale pari all''1% del canone dell''annualità, da versare entro 30 giorni dalla scadenza dell''annualità precedente (04/02/2027). Canone della seconda annualità 30.000 € → imposta 300 €, divisa a metà con la locatrice (art. XI), che registra e riaddebita.',
    150, DATE '2027-03-06', 'pending', true, 'annual',
    'Quota a nostro carico: 150 € su 300 €. Da ricalcolare ogni anno sul canone effettivo: dal 05/12/2028 il canone sale a 38.400 €/anno più la rivalutazione ISTAT. La prima annualità (registro 175 € + bollo 64 €) è già stata versata alla registrazione del 09/02/2026.'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.fiscal_deadlines
     WHERE company_id = v_company AND title LIKE 'Imposta di registro magazzino Reggello%');

  RAISE NOTICE 'Magazzino Reggello: outlet=% contratto=% fornitore=%', v_outlet, v_contract, v_alfatecno;
END $$;

COMMIT;

-- ── Verifica (attesa: 1 contratto, 3 righe di storico, 9 scadenze, 1 ricorrente, 6 allegati, 1 scadenza fiscale) ─
-- SELECT
--   (SELECT count(*) FROM contracts WHERE contract_number = 'TZM26T003665000ZH') contratto,
--   (SELECT count(*) FROM contract_amount_history h JOIN contracts c ON c.id = h.contract_id WHERE c.contract_number = 'TZM26T003665000ZH') storico,
--   (SELECT count(*) FROM contract_deadlines d JOIN contracts c ON c.id = d.contract_id WHERE c.contract_number = 'TZM26T003665000ZH') scadenze,
--   (SELECT count(*) FROM recurring_costs WHERE cost_center = 'sede_magazzino' AND description LIKE 'Canone magazzino Reggello%') ricorrente,
--   (SELECT count(*) FROM outlet_attachments a JOIN outlets o ON o.id = a.outlet_id WHERE o.code = 'SED') allegati,
--   (SELECT count(*) FROM fiscal_deadlines WHERE title LIKE 'Imposta di registro magazzino Reggello%') registro,
--   (SELECT cost_center FROM suppliers WHERE partita_iva = '03916460482') fornitore_cdc;
