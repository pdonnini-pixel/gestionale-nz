-- ROLLBACK di NZ_ONLY 261: rimette etichette e note scritte dalla 220 e toglie
-- le righe aggiunte (solo se ancora senza file). Non tocca file nello Storage.
BEGIN;

DO $$
DECLARE
  v_outlet   uuid;
  v_contract uuid;
BEGIN
  SELECT id INTO v_outlet FROM public.outlets WHERE code = 'RSO' LIMIT 1;
  IF v_outlet IS NULL THEN RETURN; END IF;
  SELECT id INTO v_contract FROM public.contracts WHERE outlet_id = v_outlet ORDER BY created_at LIMIT 1;

  UPDATE public.outlet_attachments SET label = 'Preliminare — scrittura privata v7 (firmato 10/09/2026, firma Westi assente)', notes = 'Ricevuto in PDF scansionato (10 pagine).' WHERE outlet_id = v_outlet AND attachment_type = 'preliminare';
  UPDATE public.outlet_attachments SET label = 'Contratto di affitto di ramo d''azienda — Allegato C (bozza v5)', notes = 'Ricevuta la bozza con filigrana BOZZA (47 pagine); campi vuoti: rappresentante Westi, catasto, APE, data apertura, repertorio.' WHERE outlet_id = v_outlet AND attachment_type = 'contratto';
  UPDATE public.outlet_attachments SET notes = 'Ricevuto (3 tavole De8 Architetti del 15/04/2025).' WHERE outlet_id = v_outlet AND attachment_type = 'allegato_a';
  UPDATE public.outlet_attachments SET notes = 'NON ricevuto: citato dal preliminare art. 2.1 (iii).' WHERE outlet_id = v_outlet AND attachment_type = 'allegato_b';
  UPDATE public.outlet_attachments SET label = 'Allegato B1 — Elenco beni (fino a 90.000 € acquistati da Westi)', notes = 'NON ricevuto: citato dal preliminare art. 4.2.' WHERE outlet_id = v_outlet AND attachment_type = 'allegato_b1';
  DELETE FROM public.outlet_attachments WHERE outlet_id = v_outlet AND attachment_type = 'allegato_b1_impianti' AND is_uploaded = false;
  UPDATE public.outlet_attachments SET notes = 'NON ricevute: regolano conguagli spese, cadenza addebiti SEPA e comunicazioni del fatturato.' WHERE outlet_id = v_outlet AND attachment_type = 'cg';
  UPDATE public.outlet_attachments SET notes = 'NON ricevuta.' WHERE outlet_id = v_outlet AND attachment_type = 'fideiussione';
  UPDATE public.outlet_attachments SET notes = 'Ricevuto (4 pagine).' WHERE outlet_id = v_outlet AND attachment_type = 'allegato_d';

  UPDATE public.recurring_costs SET notes = 'Contratto art. 10.1: 105 €/mq × 196 mq = 20.580 €/anno + IVA in acconto, conguaglio a consuntivo (art. 4 Condizioni Generali, non ancora ricevute). Cadenza mensile IPOTIZZATA come il canone.'
   WHERE cost_center = 'roma_soratte' AND description LIKE 'Spese di gestione Roma Soratte%' AND notes LIKE '%Cadenza confermata il 01/10/2026.%';
  UPDATE public.recurring_costs SET notes = 'Contratto art. 10.2: 95 €/mq × 196 mq = 18.620 €/anno + IVA in acconto, conguaglio a consuntivo (art. 6 Condizioni Generali). Cadenza mensile IPOTIZZATA come il canone.'
   WHERE cost_center = 'roma_soratte' AND description LIKE 'Promozione outlet Roma Soratte%' AND notes LIKE '%Cadenza confermata il 01/10/2026.%';

  UPDATE public.outlets SET notes = replace(replace(replace(notes,
      '(Condizioni Generali art. 4 e 6: 12 rate mensili SEPA con fattura trimestrale anticipata, conguaglio entro fine febbraio)',
      '(Condizioni Generali non ancora ricevute)'),
      '(fornitori scelti da noi, eccedenza a nostro carico): preventivi Kenfoster accettati, opere 25.395,66 + impianti 64.603,32 = 89.998,98 € + IVA.',
      '(fornitori scelti da noi, eccedenza a nostro carico).'),
      'Documenti mancanti (al 01/10/2026): Regolamento, Manuale operativo, contratto definitivo (oggi bozza siglata), data di consegna in comodato, dati catastali, APE, banca della fideiussione.',
      'Documenti mancanti: Condizioni Generali, Regolamento, Manuale operativo, allegati B/B1 (impianti e beni), bozza fideiussione, data di consegna in comodato, dati catastali, APE, firma di Westi sul preliminare.')
   WHERE id = v_outlet;

  UPDATE public.contracts SET notes = split_part(notes, E'\n01/10/2026: ricevuti preliminare', 1) WHERE id = v_contract;

  DELETE FROM public.contract_deadlines WHERE contract_id = v_contract AND description IN (
    'Contapersone installato nel negozio prima dell''apertura (a nostro carico)',
    'Descrizione del volume d''affari 2026 a Westi per PEC, con la documentazione fiscale (ogni anno il 31/01)',
    'Conguaglio spese di gestione e promozione 2026: nota di credito o debito da Westi (ogni anno entro fine febbraio)',
    'Descrizione del volume d''affari del semestre gennaio-giugno a Westi per PEC (ogni anno il 20/07)');
END $$;

COMMIT;
