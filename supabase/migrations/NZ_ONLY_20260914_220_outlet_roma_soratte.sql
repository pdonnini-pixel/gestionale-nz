-- ─────────────────────────────────────────────────────────────────────────────
-- NZ_ONLY 20260914_220 — Nuovo outlet ROMA SORATTE (unità B46, Roma Outlet
-- Village, Sant'Oreste RM), insegna VICOLO. Solo New Zago: è un DATO del
-- tenant, non schema (la parità #0 vale per codice e migration di schema).
--
-- Fonte: preliminare v7 firmato il 10/09/2026, Allegato C (bozza contratto di
-- affitto di ramo d'azienda), Allegato A (scheda commerciale), Allegato D
-- (privacy). Analisi in OUTLET_PRE_APERTURA_NOTES.md.
--
-- Cosa fa (solo INSERT/UPDATE, nessuna cancellazione, idempotente):
--   1. fornitore Westi S.r.l.: aggancio per P.IVA 06227950968, profilo di
--      pagamento da contratto (addebito diretto, 3 rate dalla fattura
--      trimestrale anticipata), categoria Locazione outlet, PEC e sede;
--   2. outlet RSO con tutte le condizioni economiche del contratto;
--   3. centro di costo `roma_soratte` (ruolo outlet);
--   4. conto ricavi «Corrispettivi Roma Soratte» collegato al centro di costo
--      (codice PROVVISORIO 510126, da allineare al piano dei conti del
--      commercialista: il pattern degli altri outlet è 5101xx);
--   5. contratto in `contracts` con rivalutazione, variabile e soglia di
--      recesso; storico canoni; 11 scadenze contrattuali;
--   6. tre costi ricorrenti verso Westi (canone, gestione, promozione) dal
--      5/11/2026, così Scadenzario e Cashflow li vedono;
--   7. template costi dell'outlet (locazione + spese comuni);
--   8. legame outlet↔fornitore e regola di allocazione DIRETTA su RSO;
--   9. checklist allegati (9 documenti richiesti, nessuno ancora caricato);
--  10. canali di incasso standard (cassa pronta all'apertura);
--  11. caparra già pagata (scadenza del 09/09) agganciata all'outlet;
--  12. previsione dei costi iniziali di cantiere (2.500 € + IVA alla stipula);
--  13. imposta di registro 1% del canone anno 1 fra le scadenze fiscali;
--  14. accesso all'outlet per gli utenti che già vedono TUTTI gli outlet.
--
-- Richiede la 219 (colonne rent_start_date, guarantee_expiry,
-- landlord_supplier_id) già applicata.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  v_company   uuid;
  v_outlet    uuid;
  v_westi     uuid;
  v_loc       uuid;   -- cost_categories LOC_OUTLET
  v_cond      uuid;   -- cost_categories COND_MKT
  v_contract  uuid;
  v_parent    uuid;   -- chart_of_accounts 5101
  v_sort      integer;
  v_rule      uuid;
  v_n_outlets integer;
  v_notes     text;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE vat_number = '07362100484' LIMIT 1;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Azienda New Zago (P.IVA 07362100484) non trovata: migration solo NZ';
  END IF;

  IF EXISTS (SELECT 1 FROM public.outlets WHERE company_id = v_company AND code = 'RSO') THEN
    RAISE NOTICE 'Outlet RSO già presente: nessuna modifica';
    RETURN;
  END IF;

  SELECT id INTO v_loc  FROM public.cost_categories WHERE company_id = v_company AND code = 'LOC_OUTLET' LIMIT 1;
  SELECT id INTO v_cond FROM public.cost_categories WHERE company_id = v_company AND code = 'COND_MKT'   LIMIT 1;

  -- ── 1. Fornitore Westi S.r.l. (aggancio per P.IVA, mai per nome) ──────────
  SELECT id INTO v_westi FROM public.suppliers
   WHERE company_id = v_company AND (partita_iva = '06227950968' OR vat_number = '06227950968')
   LIMIT 1;
  IF v_westi IS NULL THEN
    SELECT id INTO v_westi FROM public.suppliers
     WHERE company_id = v_company AND is_deleted = false AND lower(name) LIKE 'westi%'
     ORDER BY created_at LIMIT 1;
  END IF;
  IF v_westi IS NULL THEN
    INSERT INTO public.suppliers (company_id, name, ragione_sociale, slug, category, is_active, is_deleted, source, nazione)
    VALUES (v_company, 'Westi S.r.l.', 'Westi S.r.l.', 'westi-srl', 'Affitti', true, false, 'manual', 'IT')
    RETURNING id INTO v_westi;
  END IF;

  UPDATE public.suppliers SET
    partita_iva              = COALESCE(partita_iva, '06227950968'),
    vat_number               = COALESCE(vat_number, '06227950968'),
    codice_fiscale           = COALESCE(codice_fiscale, '06227950968'),
    fiscal_code              = COALESCE(fiscal_code, '06227950968'),
    ragione_sociale          = COALESCE(NULLIF(ragione_sociale, ''), 'Westi S.r.l.'),
    pec                      = COALESCE(pec, 'mailtocert@pec.westi.it'),
    telefono                 = COALESCE(telefono, '02/76307511'),
    indirizzo                = COALESCE(indirizzo, 'Corso Giacomo Matteotti 10'),
    citta                    = COALESCE(citta, 'Milano'),
    comune                   = COALESCE(comune, 'Milano'),
    cap                      = COALESCE(cap, '20121'),
    provincia                = COALESCE(provincia, 'MI'),
    category                 = CASE WHEN category IS NULL OR category IN ('fornitore', 'Altro') THEN 'Affitti' ELSE category END,
    cost_center              = 'roma_soratte',
    default_cost_category_id = COALESCE(default_cost_category_id, v_loc),
    -- Contratto art. 9.7: canone fatturato trimestralmente in anticipo, pagato
    -- in rate mensili anticipate il 1° del mese con addebito diretto SEPA.
    -- Stesso metodo (rid) degli altri locatori (NZ_ONLY 202).
    payment_method           = 'rid',
    default_payment_method   = 'rid',
    payment_base             = 'data_fattura',
    prima_scadenza_gg        = 0,
    numero_rate              = 3,
    payment_terms            = 0,
    default_payment_terms    = 0,
    note = COALESCE(NULLIF(note, ''), '') ||
      E'\nConcedente Roma Outlet Village (unità B46). Contratto di affitto di ramo d''azienda: canone trimestrale anticipato, addebito SEPA il 1° del mese (3 rate per fattura). Coordinata da Odissea S.r.l. Banca di addebito SEPA: da indicare (mandato alla stipula).',
    updated_at = now()
  WHERE id = v_westi;

  -- ── 2. Outlet ────────────────────────────────────────────────────────────
  v_notes := E'Affitto di ramo d''azienda, porzione B46 (Fase 1) al Roma Outlet Village, Sant''Oreste (RM). Concedente Westi S.r.l. Insegna VICOLO, abbigliamento e accessori da donna.\n'
    || E'Preliminare firmato il 10/09/2026 (caparra 20.000 € versata l''11/09). Contratto (All. C) ancora in bozza: stipula dal notaio fra 10 e 7 giorni prima dell''apertura.\n'
    || E'Apertura prevista 5/11/2026 (non vincolante, prorogabile entro il 30/11/2026; oltre, recesso entro 15 gg con restituzione caparra). Durata 8 anni dall''apertura, nessun rinnovo tacito.\n'
    || E'Canone = maggiore fra minimo garantito e 10% del volume d''affari. Minimo: 78.400 €/anno (400 €/mq) anni 1-2, 88.200 € (450 €/mq) dal 3°, poi rivalutato del maggiore fra ISTAT e 1%; regola del 90% del variabile dell''anno prima. Fatturazione trimestrale anticipata, 12 rate mensili SEPA il 1° del mese; conguagli 31/07 e 28/02. Primo anno pro rata (57 giorni ≈ 12.243 €).\n'
    || E'Spese: gestione 105 €/mq (20.580 €) + promozione 95 €/mq (18.620 €) in acconto anno 1, conguaglio a consuntivo (Condizioni Generali non ancora ricevute). Acqua a rimborso trimestrale. Energia, telefono e TARI intestati a noi.\n'
    || E'Garanzie: fideiussione bancaria 44.100 € fino a 6 mesi oltre la scadenza. Polizze RCT/RCO 5 mln, All Risks (rischio locativo 1.500 €/mq, furto 25.000 €), rinnovo entro il 31/12 di ogni anno.\n'
    || E'Uscita anticipata solo al 30° mese (≈ 5/5/2029) se il fatturato dei 12 mesi precedenti è sotto 2.625 €/mq = 514.500 €. Patto di non concorrenza 50 km (esclusa Castel Romano).\n'
    || E'Beni e attrezzature fino a 90.000 € + IVA acquistati da Westi (fornitori scelti da noi, eccedenza a nostro carico). Costi iniziali di cantiere 2.500 € + IVA alla stipula. Imposta di registro 1% sul canone anno 1.\n'
    || E'Documenti mancanti: Condizioni Generali, Regolamento, Manuale operativo, allegati B/B1 (impianti e beni), bozza fideiussione, data di consegna in comodato, dati catastali, APE, firma di Westi sul preliminare.';

  INSERT INTO public.outlets (
    company_id, name, code, brand, outlet_type, cost_center_key,
    sqm, sell_sqm, unit_code,
    mall_name, concedente, mall_manager, landlord_supplier_id,
    address, city, province, region, cap,
    delivery_date, opening_date, opening_confirmed, rent_start_date,
    contract_start, contract_end, contract_duration_months, contract_min_months,
    rent_free_days, exit_clause_month,
    rent_annual, rent_monthly, rent_per_sqm, variable_rent_pct, rent_year2_annual, rent_year3_annual,
    condo_marketing_monthly,
    deposit_guarantee, guarantee_expiry, deposit_amount, advance_payment, setup_cost,
    target_margin_pct, target_cogs_pct, min_revenue_target, exit_revenue_threshold, min_revenue_period,
    bp_status, is_active, notes
  ) VALUES (
    v_company, 'ROMA SORATTE', 'RSO', 'VICOLO', 'outlet', 'roma_soratte',
    196, 147, 'B46',
    'Roma Outlet Village', 'Westi S.r.l.', 'Westi S.r.l.', v_westi,
    'Piazza Felice Abballe 1', 'Sant''Oreste', 'RM', 'Lazio', '00060',
    NULL, DATE '2026-11-05', false, DATE '2026-11-05',
    DATE '2026-11-05', DATE '2034-11-05', 96, 30,
    0, 30,
    78400, 6533.33, 400, 10, 78400, 88200,
    3266.67,
    44100, DATE '2035-05-05', 20000, 20000, 2500,
    60, 40, 514500, 514500, '30 mesi',
    'bozza', true, v_notes
  ) RETURNING id INTO v_outlet;

  -- ── 3. Centro di costo (stessa convenzione degli altri: lower(name)) ─────
  IF NOT EXISTS (SELECT 1 FROM public.cost_centers WHERE company_id = v_company AND code = 'roma_soratte') THEN
    SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_sort FROM public.cost_centers WHERE company_id = v_company AND sort_order < 90;
    INSERT INTO public.cost_centers (company_id, code, label, color, sort_order, is_active, role)
    VALUES (v_company, 'roma_soratte', 'Roma Outlet Village (RSO)', 'bg-rose-600', v_sort, true, 'outlet');
  END IF;

  -- ── 4. Conto ricavi corrispettivi (codice provvisorio) ───────────────────
  SELECT id INTO v_parent FROM public.chart_of_accounts WHERE company_id = v_company AND code = '5101' LIMIT 1;
  IF v_parent IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE company_id = v_company AND outlet_link = 'roma_soratte') THEN
    INSERT INTO public.chart_of_accounts (company_id, code, name, macro_group, parent_id, level, ce_section, is_revenue, is_cash, is_fixed, is_recurring, default_centers, annual_amount, sort_order, is_active, outlet_link, note)
    SELECT v_company, '510126', 'Corrispettivi Roma Soratte', 'ricavi', v_parent, 3, 'A.1', true, true, false, true, ARRAY['all'], 0,
           COALESCE((SELECT MAX(sort_order) FROM public.chart_of_accounts WHERE company_id = v_company AND parent_id = v_parent), 118) + 1,
           true, 'roma_soratte',
           'Codice PROVVISORIO assegnato il 14/09/2026 (pattern 5101xx degli altri outlet): allineare al codice del piano dei conti del commercialista alla prima importazione di bilancio.'
    WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE company_id = v_company AND code = '510126');
  END IF;

  -- ── 5. Contratto, storico canoni, scadenze contrattuali ──────────────────
  INSERT INTO public.contracts (
    company_id, outlet_id, name, contract_type, counterpart, cost_category_id,
    monthly_amount, annual_amount, vat_rate, deposit_amount,
    start_date, end_date, notice_days, auto_renewal, renewal_period_months,
    escalation_type, escalation_rate, escalation_date, escalation_frequency_months,
    min_revenue_clause, min_revenue_period, variable_rent_pct, variable_rent_threshold, sqm, status, notes
  ) VALUES (
    v_company, v_outlet, 'Affitto ramo d''azienda B46 — Roma Outlet Village', 'affitto_ramo_azienda', 'Westi S.r.l.', v_loc,
    6533.33, 78400, 22, 44100,
    DATE '2026-11-05', DATE '2034-11-05', 30, false, NULL,
    -- escalation_rate e variable_rent_pct sono numeric a 4 decimali (frazioni):
    -- 0.01 = +1% minimo di rivalutazione, 0.10 = 10% del volume d'affari.
    'istat_min_1pct', 0.01, DATE '2029-01-01', 12,
    514500, '12 mesi precedenti il 30° mese', 0.10, 784000, 196, 'attivo',
    E'BOZZA (All. C v5, siglata 10/09/2026): stipula prevista fra il 26 e il 29/10/2026. Canone = max(minimo garantito; 10% volume d''affari). Minimo 78.400 anni 1-2, 88.200 dal 3°, poi max(ISTAT; +1%) e regola del 90%. Fatturazione trimestrale anticipata, rate mensili SEPA il 1°; conguagli 31/07 e 28/02; primo trimestre pro rata in 3 quote (0/15/30 gg). Il variabile supera il minimo sopra 784.000 € (anno 1-2) e 882.000 € (anno 3). Recesso solo al 30° mese con fatturato < 514.500 €, effetto dopo 6 mesi. Fideiussione 44.100 € a prima richiesta (+6 mesi). Foro Milano.'
  ) RETURNING id INTO v_contract;

  INSERT INTO public.contract_amount_history (contract_id, effective_date, previous_amount, new_amount, reason) VALUES
    (v_contract, DATE '2026-11-05', NULL,  78400, 'Canone annuo garantito anno 1: 400 €/mq × 196 mq (art. 9.2). Primo anno pro rata dal 5/11 al 31/12/2026.'),
    (v_contract, DATE '2028-01-01', 78400, 88200, 'Previsto da contratto: anno 3 a 450 €/mq (art. 9.4). Da confermare a gennaio 2028 con la regola del 90% del variabile 2027.');

  INSERT INTO public.contract_deadlines (contract_id, deadline_date, description, notes) VALUES
    (v_contract, DATE '2026-10-06', 'Termine per la comunicazione della Data di Apertura da parte di Westi (30 giorni prima)', 'Preliminare art. 3.2'),
    (v_contract, DATE '2026-10-26', 'Lavori per l''agibilità completati e documentazione consegnata (10 giorni prima dell''apertura)', 'Preliminare art. 4.8 · All. C art. 4.5'),
    (v_contract, DATE '2026-10-28', 'Stipula dal notaio: costi iniziali 2.500 € + IVA, mandato SEPA, fideiussione 44.100 €, polizze, copia di Regolamento e Condizioni Generali', 'Preliminare art. 2.2, 5.1, 9.2 · All. C art. 20.1, 21.1 (fra 10 e 7 giorni prima dell''apertura)'),
    (v_contract, DATE '2026-11-05', 'Apertura prevista (decorrenza canone e durata)', 'Preliminare art. 3.2 · All. C art. 9.1'),
    (v_contract, DATE '2026-11-30', 'Ultimo giorno utile per la proroga dell''apertura da parte di Westi; oltre, nostro recesso entro 15 giorni con restituzione della caparra', 'Preliminare art. 3.3-3.4'),
    (v_contract, DATE '2026-12-31', 'Rinnovo polizze RCT/RCO e All Risks e consegna quietanze (ogni anno)', 'All. C art. 21.5'),
    (v_contract, DATE '2027-02-28', 'Conguaglio canone variabile 10% del volume d''affari 2026 (ogni anno il 28/02)', 'All. C art. 9.7'),
    (v_contract, DATE '2027-07-31', 'Conguaglio semestrale gennaio-giugno (ogni anno il 31/07)', 'All. C art. 9.7'),
    (v_contract, DATE '2028-01-01', 'Canone minimo a 88.200 € (450 €/mq): aggiornare canone e costo ricorrente', 'All. C art. 9.4'),
    (v_contract, DATE '2029-05-05', 'Trentesimo mese: finestra di 30 giorni per il recesso se il fatturato dei 12 mesi precedenti è sotto 514.500 €', 'All. C art. 17.1'),
    (v_contract, DATE '2034-11-05', 'Scadenza naturale del contratto (8 anni), nessun rinnovo tacito; riconsegna in contraddittorio', 'All. C art. 8.1, 15'),
    (v_contract, DATE '2035-05-05', 'Fine validità della fideiussione (6 mesi dopo la scadenza)', 'All. C art. 20.1');

  -- ── 6. Costi ricorrenti verso Westi (Scadenzario e Cashflow) ─────────────
  INSERT INTO public.recurring_costs (company_id, cost_center, cost_category_id, description, amount, frequency, day_of_month, month_start, start_date, payment_method, supplier_name, is_active, notes)
  SELECT v_company, 'roma_soratte', v_loc, 'Canone Roma Soratte (B46) — minimo garantito', 6533.33, 'monthly', 1, 11, DATE '2026-11-05', 'rid', 'Westi S.r.l.', true,
         'Contratto art. 9: 78.400 €/anno + IVA in 12 rate mensili anticipate, addebito SEPA il 1° del mese. Novembre 2026 pro rata (57 gg). Dal 2028: 88.200 €/anno.'
  WHERE NOT EXISTS (SELECT 1 FROM public.recurring_costs WHERE company_id = v_company AND cost_center = 'roma_soratte' AND description LIKE 'Canone Roma Soratte%');

  INSERT INTO public.recurring_costs (company_id, cost_center, cost_category_id, description, amount, frequency, day_of_month, month_start, start_date, payment_method, supplier_name, is_active, notes)
  SELECT v_company, 'roma_soratte', v_cond, 'Spese di gestione Roma Soratte (B46) — acconto', 1715.00, 'monthly', 1, 11, DATE '2026-11-05', 'rid', 'Westi S.r.l.', true,
         'Contratto art. 10.1: 105 €/mq × 196 mq = 20.580 €/anno + IVA in acconto, conguaglio a consuntivo (art. 4 Condizioni Generali, non ancora ricevute). Cadenza mensile IPOTIZZATA come il canone.'
  WHERE NOT EXISTS (SELECT 1 FROM public.recurring_costs WHERE company_id = v_company AND cost_center = 'roma_soratte' AND description LIKE 'Spese di gestione Roma Soratte%');

  INSERT INTO public.recurring_costs (company_id, cost_center, cost_category_id, description, amount, frequency, day_of_month, month_start, start_date, payment_method, supplier_name, is_active, notes)
  SELECT v_company, 'roma_soratte', v_cond, 'Promozione outlet Roma Soratte (B46) — acconto', 1551.67, 'monthly', 1, 11, DATE '2026-11-05', 'rid', 'Westi S.r.l.', true,
         'Contratto art. 10.2: 95 €/mq × 196 mq = 18.620 €/anno + IVA in acconto, conguaglio a consuntivo (art. 6 Condizioni Generali). Cadenza mensile IPOTIZZATA come il canone.'
  WHERE NOT EXISTS (SELECT 1 FROM public.recurring_costs WHERE company_id = v_company AND cost_center = 'roma_soratte' AND description LIKE 'Promozione outlet Roma Soratte%');

  -- ── 7. Template costi dell'outlet ────────────────────────────────────────
  IF v_loc IS NOT NULL THEN
    INSERT INTO public.outlet_cost_template (outlet_id, cost_category_id, budget_monthly, budget_annual, is_fixed, is_active, notes)
    VALUES (v_outlet, v_loc, 6533.33, 78400, true, true, 'Canone minimo garantito anno 1-2 (400 €/mq). Dal 2028: 88.200 €.');
  END IF;
  IF v_cond IS NOT NULL THEN
    INSERT INTO public.outlet_cost_template (outlet_id, cost_category_id, budget_monthly, budget_annual, is_fixed, is_active, notes)
    VALUES (v_outlet, v_cond, 3266.67, 39200, true, true, 'Spese di gestione 105 €/mq + promozione 95 €/mq (acconti anno 1).');
  END IF;

  -- ── 8. Legame outlet↔fornitore e allocazione diretta ─────────────────────
  INSERT INTO public.outlet_suppliers (outlet_id, supplier_id, is_active, default_payment_method, default_payment_terms, notes)
  VALUES (v_outlet, v_westi, true, 'rid', 0, 'Concedente: canone, spese di gestione, promozione, acqua, riaddebiti (registro, pratiche).');

  SELECT id INTO v_rule FROM public.supplier_allocation_rules WHERE company_id = v_company AND supplier_id = v_westi AND is_active = true LIMIT 1;
  IF v_rule IS NULL THEN
    INSERT INTO public.supplier_allocation_rules (company_id, supplier_id, allocation_mode, description, is_active)
    VALUES (v_company, v_westi, 'DIRETTO', 'Westi S.r.l.: tutti i costi al Roma Outlet Village (RSO)', true)
    RETURNING id INTO v_rule;
    INSERT INTO public.supplier_allocation_details (rule_id, outlet_id, percentage) VALUES (v_rule, v_outlet, 100);
  END IF;

  -- ── 9. Checklist allegati (nessun file caricato: si caricano dalla scheda) ─
  INSERT INTO public.outlet_attachments (company_id, outlet_id, attachment_type, label, is_required, is_uploaded, notes) VALUES
    (v_company, v_outlet, 'preliminare',   'Preliminare — scrittura privata v7 (firmato 10/09/2026, firma Westi assente)', true, false, 'Ricevuto in PDF scansionato (10 pagine).'),
    (v_company, v_outlet, 'contratto',     'Contratto di affitto di ramo d''azienda — Allegato C (bozza v5)', true, false, 'Ricevuta la bozza con filigrana BOZZA (47 pagine); campi vuoti: rappresentante Westi, catasto, APE, data apertura, repertorio.'),
    (v_company, v_outlet, 'allegato_a',    'Allegato A — Scheda commerciale e planimetria B46', true, false, 'Ricevuto (3 tavole De8 Architetti del 15/04/2025).'),
    (v_company, v_outlet, 'allegato_b',    'Allegato B — Elenco impianti e cespiti', true, false, 'NON ricevuto: citato dal preliminare art. 2.1 (iii).'),
    (v_company, v_outlet, 'allegato_b1',   'Allegato B1 — Elenco beni (fino a 90.000 € acquistati da Westi)', true, false, 'NON ricevuto: citato dal preliminare art. 4.2.'),
    (v_company, v_outlet, 'allegato_d',    'Allegato D — Informativa privacy tenants v1.3', true, false, 'Ricevuto (4 pagine).'),
    (v_company, v_outlet, 'cg',            'Condizioni Generali (All. B del contratto)', true, false, 'NON ricevute: regolano conguagli spese, cadenza addebiti SEPA e comunicazioni del fatturato.'),
    (v_company, v_outlet, 'reg',           'Regolamento immobiliare e commerciale', true, false, 'NON ricevuto: orari e servizi comuni (violazione = risoluzione).'),
    (v_company, v_outlet, 'fideiussione',  'Bozza garanzia bancaria 44.100 € (All. D del contratto)', true, false, 'NON ricevuta.');

  -- ── 10. Canali di incasso standard (come «Crea canali standard» in Incassi) ─
  INSERT INTO public.outlet_payment_channels (company_id, outlet_id, label, kind, settlement_days, counts_in_total, sort_order, is_active, bank_tolerance_pct) VALUES
    (v_company, v_outlet, 'Contanti',    'contanti',  1, true, 1, true, 0),
    (v_company, v_outlet, 'POS',         'pos',       1, true, 2, true, 1.5),
    (v_company, v_outlet, 'Pay by link', 'paybylink', 1, true, 3, true, 0),
    (v_company, v_outlet, 'Fatture',     'fattura',   1, true, 4, true, 0),
    (v_company, v_outlet, 'Bonifico',    'bonifico',  1, true, 5, true, 0);

  -- ── 11. Caparra già pagata: agganciata all'outlet ────────────────────────
  UPDATE public.payables SET
    outlet_id = v_outlet,
    supplier_vat = COALESCE(supplier_vat, '06227950968'),
    notes = COALESCE(NULLIF(notes, ''), '') || E'\nCaparra confirmatoria (preliminare art. 6.1): alla stipula diventa acconto sul canone. Non è un costo di locazione.',
    updated_at = now()
  WHERE company_id = v_company AND supplier_id = v_westi AND outlet_id IS NULL
    AND invoice_number ILIKE '%caparra%';

  -- ── 12. Previsione: costi iniziali di cantiere alla stipula ──────────────
  INSERT INTO public.payables (company_id, supplier_id, supplier_name, supplier_vat, outlet_id, cost_category_id,
    invoice_number, invoice_date, due_date, original_due_date, gross_amount, net_amount, vat_amount,
    amount_paid, amount_remaining, status, payment_method, is_forecast, notes)
  SELECT v_company, v_westi, 'Westi S.r.l.', '06227950968', v_outlet, v_cond,
    '[PREV] Costi iniziali cantiere B46 (preliminare art. 5.1)', DATE '2026-10-28', DATE '2026-10-28', DATE '2026-10-28', 3050, 2500, 550,
    0, 3050, 'da_pagare', 'bonifico_ordinario', true,
    'Previsione dal preliminare: 2.500 € + IVA per pulizia, energia di cantiere, container e discarica, a mezzo bonifico alla stipula dal notaio (data stimata: fra 10 e 7 giorni prima dell''apertura). Sostituire con la fattura reale.'
  WHERE NOT EXISTS (SELECT 1 FROM public.payables WHERE company_id = v_company AND supplier_id = v_westi AND invoice_number = '[PREV] Costi iniziali cantiere B46 (preliminare art. 5.1)');

  -- ── 13. Imposta di registro 1% del canone anno 1 ─────────────────────────
  INSERT INTO public.fiscal_deadlines (company_id, deadline_type, title, description, amount, due_date, status, is_recurring, notes)
  SELECT v_company, 'altro', 'Imposta di registro contratto B46 Roma Soratte (1% canone anno 1)',
    'Contratto art. 23.3: imposta di registro proporzionale 1% sul canone garantito del primo anno (78.400 €), versata alla registrazione; conguagli degli anni successivi versati da Westi e riaddebitati al 100% (rimborso entro 7 giorni dalla fattura).',
    784, DATE '2026-10-28', 'pending', false,
    'Importo base «Euro ____» lasciato vuoto nella bozza: 784 € calcolati su 78.400 €. Data = stipula stimata.'
  WHERE NOT EXISTS (SELECT 1 FROM public.fiscal_deadlines WHERE company_id = v_company AND title LIKE 'Imposta di registro contratto B46%');

  -- ── 14. Accesso: chi già vede TUTTI gli outlet vede anche questo ─────────
  SELECT COUNT(*) INTO v_n_outlets FROM public.outlets WHERE company_id = v_company AND id <> v_outlet;
  INSERT INTO public.user_outlet_access (user_id, outlet_id, can_write, company_id)
  SELECT u.user_id, v_outlet, bool_and(u.can_write), v_company
    FROM public.user_outlet_access u
    JOIN public.outlets o ON o.id = u.outlet_id AND o.company_id = v_company
   WHERE u.outlet_id <> v_outlet
   GROUP BY u.user_id
  HAVING COUNT(DISTINCT u.outlet_id) >= v_n_outlets
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Outlet RSO creato: outlet=% contratto=% fornitore=%', v_outlet, v_contract, v_westi;
END $$;

COMMIT;

-- ── Verifica (attesa: 1 outlet, 1 cc, 1 conto, 1 contratto, 12 scadenze, 3 ricorrenti, 2 template, 9 allegati, 5 canali) ─
-- SELECT
--   (SELECT count(*) FROM outlets WHERE code='RSO') outlet,
--   (SELECT count(*) FROM cost_centers WHERE code='roma_soratte') cc,
--   (SELECT count(*) FROM chart_of_accounts WHERE outlet_link='roma_soratte') conto,
--   (SELECT count(*) FROM contracts c JOIN outlets o ON o.id=c.outlet_id WHERE o.code='RSO') contratti,
--   (SELECT count(*) FROM contract_deadlines d JOIN contracts c ON c.id=d.contract_id JOIN outlets o ON o.id=c.outlet_id WHERE o.code='RSO') scadenze,
--   (SELECT count(*) FROM recurring_costs WHERE cost_center='roma_soratte') ricorrenti,
--   (SELECT count(*) FROM outlet_cost_template t JOIN outlets o ON o.id=t.outlet_id WHERE o.code='RSO') template,
--   (SELECT count(*) FROM outlet_attachments a JOIN outlets o ON o.id=a.outlet_id WHERE o.code='RSO') allegati,
--   (SELECT count(*) FROM outlet_payment_channels p JOIN outlets o ON o.id=p.outlet_id WHERE o.code='RSO') canali,
--   (SELECT partita_iva FROM suppliers WHERE partita_iva='06227950968') westi_piva;
