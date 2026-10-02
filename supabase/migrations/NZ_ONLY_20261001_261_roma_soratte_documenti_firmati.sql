-- =====================================================================
-- NZ_ONLY 261 — Roma Soratte (RSO): documenti controfirmati da Westi
--
-- Il 01/10/2026 sono arrivati i 9 PDF siglati da Westi (Claudio Tierno) il
-- 10/09/2026: preliminare, Allegato A (planimetria B46), Allegato B (cespiti),
-- Allegato B1 in due preventivi Kenfoster (opere e impianti), bozza del
-- contratto (All. C), Condizioni Generali, modello di garanzia bancaria,
-- informativa privacy. Il Regolamento non e' fra questi.
--
-- Cosa cambia:
--   1. etichette e note degli allegati ricevuti; nuova riga per il secondo
--      file dell'Allegato B1 (impianti), perche' ogni riga tiene un file;
--   2. Condizioni Generali art. 4 e 6: la cadenza mensile di gestione e
--      promozione, scritta il 14/09 come IPOTESI, e' confermata;
--   3. note di outlet e contratto: beni Kenfoster 89.998,98 € + IVA (paga
--      Westi), obblighi di comunicazione del volume d'affari, documenti che
--      mancano ancora;
--   4. 4 scadenze nuove (contapersone, volume d'affari annuale e semestrale,
--      conguaglio spese).
--
-- I file NON sono caricati da questa migration: is_uploaded resta false
-- finche' il PDF non e' nel bucket outlet-attachments.
-- NO DATA LOSS: solo UPDATE mirati (replace di frasi scritte dalla 220,
-- righe mai toccate a mano dal 14/09) e INSERT idempotenti.
--
-- Applicata su NZ il 01/10/2026 un'istruzione alla volta con execute_sql
-- (apply_migration andava in timeout sul blocco intero): fatti i punti 1,
-- 3 e 4. Il punto 2 (note dei due costi ricorrenti) e' passato il
-- 02/10/2026 con il testo breve qui sotto: la versione lunga della frase
-- faceva andare in timeout il connettore. Rilanciare il file non duplica
-- niente.
-- =====================================================================
BEGIN;

DO $$
DECLARE
  v_outlet   uuid;
  v_company  uuid;
  v_contract uuid;
BEGIN
  SELECT id, company_id INTO v_outlet, v_company FROM public.outlets WHERE code = 'RSO' LIMIT 1;
  IF v_outlet IS NULL THEN
    RAISE NOTICE 'Outlet RSO assente: niente da fare';
    RETURN;
  END IF;
  SELECT id INTO v_contract FROM public.contracts WHERE outlet_id = v_outlet ORDER BY created_at LIMIT 1;

  -- ── 1. Allegati ──────────────────────────────────────────────────────────
  UPDATE public.outlet_attachments SET
    label = 'Preliminare — scrittura privata v7 (firmata da entrambe le parti il 10/09/2026)',
    notes = 'Copia controfirmata da Westi (Claudio Tierno), siglata 10/09/2026 su ogni pagina, ricevuta il 01/10/2026 (10 pagine). Resta vuota la data di consegna in comodato (art. 4.4). Art. 4.3: sopralluogo 23/06/2026, progetto consegnato il 10/07/2026 e approvato.'
  WHERE outlet_id = v_outlet AND attachment_type = 'preliminare' AND is_uploaded = false;

  UPDATE public.outlet_attachments SET
    label = 'Contratto di affitto di ramo d''azienda — Allegato C (bozza v5 siglata da Westi)',
    notes = 'Bozza con filigrana BOZZA (47 pagine) siglata da Westi il 10/09/2026, ricevuta il 01/10/2026. Testo identico alla bozza usata il 14/09: restano vuoti rappresentanti, dati catastali, APE, data di apertura, base dell''imposta di registro, repertorio. Il contratto definitivo si firma dal notaio. Nel contratto gli allegati sono A planimetria, B Condizioni Generali, C impianti e cespiti, D garanzia bancaria, E informativa.'
  WHERE outlet_id = v_outlet AND attachment_type = 'contratto' AND is_uploaded = false;

  UPDATE public.outlet_attachments SET
    notes = 'Copia siglata da Westi il 10/09/2026, ricevuta il 01/10/2026 (3 tavole De8 Architetti del 15/04/2025: inquadramento, pianta B46 196 mq, fronte vetrina e sezione).'
  WHERE outlet_id = v_outlet AND attachment_type = 'allegato_a' AND is_uploaded = false;

  UPDATE public.outlet_attachments SET
    notes = 'Ricevuto il 01/10/2026, siglato da Westi il 10/09/2026 (1 pagina). Consegna: interruttore generale e linea elettrica fino al retronegozio, acqua con contatore, sottofondo esistente e pareti a rustico, predisposizione telefonica, vetrine in alluminio preverniciato, bagno con controsoffitto, 1 WC, 2 lavandini, aspiratore, attacco per boiler elettrico.'
  WHERE outlet_id = v_outlet AND attachment_type = 'allegato_b' AND is_uploaded = false;

  UPDATE public.outlet_attachments SET
    label = 'Allegato B1 — Elenco beni: preventivo opere Kenfoster',
    notes = 'Ricevuto il 01/10/2026. Preventivo Kenfoster Srl (P.IVA 04211030962) del 02/09/2026 intestato a Westi, accettato con timbro New Zago e siglato da Westi: pareti divisorie, contropareti, camerini, lesena, controsoffitti, zerbino. 25.395,66 € + IVA. Con gli impianti (64.603,32 €) i beni fanno 89.998,98 € + IVA, sotto il tetto di 90.000 € del preliminare art. 4.2. Li paga Westi: nessuna scadenza per New Zago, salvo eccedenze. Lavori dal 15/09 al 25/10/2026.'
  WHERE outlet_id = v_outlet AND attachment_type = 'allegato_b1' AND is_uploaded = false;

  INSERT INTO public.outlet_attachments (company_id, outlet_id, attachment_type, label, is_required, is_uploaded, notes)
  SELECT v_company, v_outlet, 'allegato_b1_impianti', 'Allegato B1 — Elenco beni: preventivo impianti Kenfoster', true, false,
         'Ricevuto il 01/10/2026. Preventivo Kenfoster Srl del 02/09/2026 intestato a Westi, accettato con timbro New Zago e siglato da Westi: quadro elettrico, illuminazione a binari (17.200 €), emergenza, rete dati, diffusione sonora, climatizzazione Daikin con recuperatore, barriera d''aria, canalizzazioni. 64.603,32 € + IVA. Insieme alle opere: 89.998,98 € + IVA, pagati da Westi.'
  WHERE NOT EXISTS (SELECT 1 FROM public.outlet_attachments WHERE outlet_id = v_outlet AND attachment_type = 'allegato_b1_impianti');

  UPDATE public.outlet_attachments SET
    notes = 'Ricevute il 01/10/2026 (33 pagine, siglate da Westi il 10/09/2026). Gestione (art. 4) e promozione (art. 6): 12 rate mensili SEPA, fattura trimestrale anticipata il 1/1, 1/4, 1/7, 1/10; conguaglio con nota di credito o debito entro fine febbraio. Volume d''affari (art. 2.5): ogni lunedì entro le 12, il 3 di ogni mese, per PEC entro il 20/07 e il 31/01. Contapersone a nostro carico prima dell''apertura (art. 2.10). Penali art. 15.1.'
  WHERE outlet_id = v_outlet AND attachment_type = 'cg' AND is_uploaded = false;

  UPDATE public.outlet_attachments SET
    notes = 'Ricevuta il 01/10/2026: modello di garanzia bancaria a prima domanda (in testa «Allegato F»), siglato da Westi, con i campi vuoti. Importo 44.100 € e durata fino al sesto mese dopo la scadenza dal contratto art. 20.1. Banca ancora da scegliere.'
  WHERE outlet_id = v_outlet AND attachment_type = 'fideiussione' AND is_uploaded = false;

  UPDATE public.outlet_attachments SET
    notes = 'Copia siglata da Westi il 10/09/2026, ricevuta il 01/10/2026 (4 pagine). Nel contratto è l''Allegato E.'
  WHERE outlet_id = v_outlet AND attachment_type = 'allegato_d' AND is_uploaded = false;

  -- ── 2. Costi ricorrenti: cadenza confermata dalle Condizioni Generali ───
  UPDATE public.recurring_costs SET
    notes = replace(notes,
      '(art. 4 Condizioni Generali, non ancora ricevute). Cadenza mensile IPOTIZZATA come il canone.',
      '(Condizioni Generali art. 4: 12 rate mensili, fattura trimestrale anticipata, conguaglio entro fine febbraio). Cadenza confermata il 01/10/2026.'),
    updated_at = now()
  WHERE company_id = v_company AND cost_center = 'roma_soratte'
    AND description LIKE 'Spese di gestione Roma Soratte%' AND notes LIKE '%IPOTIZZATA%';

  UPDATE public.recurring_costs SET
    notes = replace(notes,
      '(art. 6 Condizioni Generali). Cadenza mensile IPOTIZZATA come il canone.',
      '(Condizioni Generali art. 6: 12 rate mensili, fattura trimestrale anticipata, conguaglio entro fine febbraio). Cadenza confermata il 01/10/2026.'),
    updated_at = now()
  WHERE company_id = v_company AND cost_center = 'roma_soratte'
    AND description LIKE 'Promozione outlet Roma Soratte%' AND notes LIKE '%IPOTIZZATA%';

  -- ── 3. Note di outlet e contratto ────────────────────────────────────────
  UPDATE public.outlets SET
    notes = replace(replace(replace(notes,
      '(Condizioni Generali non ancora ricevute)',
      '(Condizioni Generali art. 4 e 6: 12 rate mensili SEPA con fattura trimestrale anticipata, conguaglio entro fine febbraio)'),
      '(fornitori scelti da noi, eccedenza a nostro carico).',
      '(fornitori scelti da noi, eccedenza a nostro carico): preventivi Kenfoster accettati, opere 25.395,66 + impianti 64.603,32 = 89.998,98 € + IVA.'),
      'Documenti mancanti: Condizioni Generali, Regolamento, Manuale operativo, allegati B/B1 (impianti e beni), bozza fideiussione, data di consegna in comodato, dati catastali, APE, firma di Westi sul preliminare.',
      'Documenti mancanti (al 01/10/2026): Regolamento, Manuale operativo, contratto definitivo (oggi bozza siglata), data di consegna in comodato, dati catastali, APE, banca della fideiussione.'),
    updated_at = now()
  WHERE id = v_outlet AND notes LIKE '%firma di Westi sul preliminare.%';

  UPDATE public.contracts SET
    notes = notes || E'\n01/10/2026: ricevuti preliminare e allegati siglati da Westi il 10/09/2026; il testo del contratto non cambia. Condizioni Generali: volume d''affari da comunicare ogni lunedì entro le 12 (con ingressi del contapersone, articoli e scontrini), il 3 di ogni mese, e per PEC entro il 20/07 (semestre) e il 31/01 (anno). Penali: 1.000 €/giorno per comunicazioni mensili, semestrali o annuali mancate, 500 €/giorno per la settimanale dopo diffida di 7 giorni. Mora: Euribor 1 mese + 4 punti.',
    updated_at = now()
  WHERE id = v_contract AND notes NOT LIKE '%01/10/2026: ricevuti preliminare%';

  -- ── 4. Scadenze nuove dalle Condizioni Generali ──────────────────────────
  IF v_contract IS NOT NULL THEN
    INSERT INTO public.contract_deadlines (contract_id, deadline_date, description, notes)
    SELECT v_contract, t.d, t.descr, t.n
      FROM (VALUES
        (DATE '2026-11-04', 'Contapersone installato nel negozio prima dell''apertura (a nostro carico)', 'Condizioni Generali art. 2.10'),
        (DATE '2027-01-31', 'Descrizione del volume d''affari 2026 a Westi per PEC, con la documentazione fiscale (ogni anno il 31/01)', 'Condizioni Generali art. 2.5 (iii) · penale 1.000 €/giorno (art. 15.1 d)'),
        (DATE '2027-02-28', 'Conguaglio spese di gestione e promozione 2026: nota di credito o debito da Westi (ogni anno entro fine febbraio)', 'Condizioni Generali art. 4.5 e 6.4'),
        (DATE '2027-07-20', 'Descrizione del volume d''affari del semestre gennaio-giugno a Westi per PEC (ogni anno il 20/07)', 'Condizioni Generali art. 2.5 (iii) · penale 1.000 €/giorno (art. 15.1 d)')
      ) AS t(d, descr, n)
     WHERE NOT EXISTS (SELECT 1 FROM public.contract_deadlines x WHERE x.contract_id = v_contract AND x.description = t.descr);
  END IF;
END $$;

COMMIT;

-- ── Verifica (attesa: 10 allegati, 0 caricati; 2 ricorrenti senza IPOTIZZATA; 16 scadenze) ──
-- SELECT
--   (SELECT count(*) FROM outlet_attachments a JOIN outlets o ON o.id = a.outlet_id WHERE o.code = 'RSO') allegati,
--   (SELECT count(*) FROM outlet_attachments a JOIN outlets o ON o.id = a.outlet_id WHERE o.code = 'RSO' AND a.is_uploaded) caricati,
--   (SELECT count(*) FROM recurring_costs WHERE cost_center = 'roma_soratte' AND notes LIKE '%IPOTIZZATA%') ipotesi,
--   (SELECT count(*) FROM contract_deadlines d JOIN contracts c ON c.id = d.contract_id JOIN outlets o ON o.id = c.outlet_id WHERE o.code = 'RSO') scadenze;
