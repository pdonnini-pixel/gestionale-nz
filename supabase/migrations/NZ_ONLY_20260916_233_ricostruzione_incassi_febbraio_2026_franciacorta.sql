-- =====================================================================
-- NZ_ONLY 233 — Febbraio 2026, le 28 giornate di FRANCIACORTA
-- ---------------------------------------------------------------------
-- Completa la 232, che aveva caricato febbraio per cinque punti vendita su
-- sei. Mancava Franciacorta perche' il suo specchietto era un .xls nel
-- vecchio formato binario di Excel, illeggibile dal connettore Drive.
-- Patrizio lo ha risalvato come Foglio Google e da li' si e' letto.
--
-- FONTE: Drive, "Nuovo Specchietto incassi FEBBRAIO 2026 Franciacorta"
--        (Foglio Google, 16/09/2026)
--
-- CONTROLLO DI LETTURA: il foglio ha molte celle vuote e le colonne si
-- leggono per posizione, quindi prima di caricare sono stati confrontati
-- tutti e dieci i totali di colonna con la riga "Totali" del foglio:
--   INCASSO 55.718,39 | FATTURE 112,08 | POS MPS 43.839,00 | MPS AMEX 0,00
--   POS BCC 817,35 | BCC AMEX 1.141,12 | PAY BY LINK 0,00 | BONIFICO 0,00
--   SPESE CASSA 38,00 | VERSAMENTI 9.995,00
-- Tutti e dieci coincidono, e i corrispettivi coincidono con daily_revenue
-- su tutte e 28 le giornate.
--
-- DECISIONI DOCUMENTATE:
--  1. Il versamento di 1.895,00 del 23-28/02 NON si registra qui: esce
--     dalla cassa il 04/03 ed e' gia' sulla chiusura del 04/03, messo li'
--     dalla 232 leggendolo dall'estratto conto. Restano dentro febbraio
--     8.100,00 dei 9.995,00 totali del foglio.
--  2. Franciacorta 24/02, 1.575,00: in banca c'e', ma versato allo
--     sportello ATM 01030-4715 invece del solito 2121. Il motore riconosce
--     il negozio dalla causale e quello sportello non lo conosce, quindi
--     l'aggancio e' a mano.
--  3. Franciacorta 25/02, 2.145,00: in banca il 18/02, sette giorni PRIMA
--     della giornata su cui il negozio lo dichiara (causale "10-16/02").
--     Quinto caso di versamento anteriore alla chiusura dichiarata, dopo
--     Torino 17/06, Franciacorta 14/05, Brugnato 15/04 e 21/04.
--  4. Due giornate non quadrano per arrotondamento e restano dichiarate:
--     14/02 (-0,17) e 28/02 (-0,54).
--  5. Il 05/02 il negozio emette una fattura di 112,08: come negli altri
--     mesi l'importo viaggia dentro i mezzi di pagamento, quindi va nel
--     canale Fatture e la giornata quadra.
--
-- ESITO: 4 versamenti dentro febbraio, 4 trovati in banca. Febbraio passa
--        da 139 a 167 chiusure, 163 verificate, e il registro corrispettivi
--        non ha piu' nessuna giornata senza dettaglio in tutto il 2026.
--
-- NO DATA LOSS: solo INSERT. La proiezione riempie il dettaglio di 28
-- righe di daily_revenue che esistevano gia' con lo stesso gross_revenue.
-- Applicata su NZ il 16/09/2026. Solo NZ.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE _stg_incassi_febbraio_fr (
  outlet text, giorno date, incasso numeric, contanti numeric, mps numeric, mpsx numeric,
  bcc numeric, bccx numeric, pbl numeric, fatture numeric, bonifico numeric,
  spese numeric, spese_note text, versamento numeric, vers_note text, nota text) ON COMMIT DROP;

INSERT INTO _stg_incassi_febbraio_fr VALUES
('FRANCIACORTA','2026-02-01',5859.33,792.0,4896.83,0.0,0.0,170.5,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-02',1163.05,299.3,815.75,0.0,0.0,48.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-03',998.3,89.9,908.4,0.0,0.0,0.0,0.0,0.0,0.0,38.0,'A GIUSTACCHINI SF_877',0.0,NULL,NULL),
('FRANCIACORTA','2026-02-04',1012.4,345.4,610.5,0.0,56.5,0.0,0.0,0.0,0.0,0.0,NULL,1145.0,'01-03/02/2026',NULL),
('FRANCIACORTA','2026-02-05',1770.28,794.0,1050.92,0.0,0.0,37.44,0.0,112.08,0.0,0.0,NULL,0.0,NULL,'il 05/02 emessa fattura di 112,08, incassata dentro i mezzi di pagamento'),
('FRANCIACORTA','2026-02-06',1951.58,188.0,1450.5,0.0,149.4,163.68,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-07',4190.13,864.3,3147.23,0.0,178.6,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-08',5193.2,1016.05,4070.11,0.0,10.0,97.04,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-09',565.81,27.35,538.46,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-10',670.9,208.7,462.2,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,3235.0,'04-09/02/2026',NULL),
('FRANCIACORTA','2026-02-11',798.18,138.8,603.62,0.0,0.0,55.76,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-12',603.46,99.2,504.26,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-13',760.75,477.65,234.6,0.0,48.5,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-14',2904.63,557.63,2346.83,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,'giornata non quadrata sullo specchietto: canali 2904.46 contro corrispettivi+fatture 2904.63'),
('FRANCIACORTA','2026-02-15',2707.9,568.6,1977.8,0.0,0.0,161.5,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-16',1298.74,95.0,1203.74,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-17',592.55,0.0,566.3,0.0,26.25,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-18',1064.34,79.3,985.04,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-19',845.8,0.0,845.8,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-20',2056.0,358.7,1577.3,0.0,120.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-21',4168.8,417.7,3672.5,0.0,25.8,52.8,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-22',3905.7,721.1,2987.8,0.0,110.0,86.8,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-23',1024.5,315.9,587.6,0.0,42.0,79.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-24',979.1,67.1,861.7,0.0,50.3,0.0,0.0,0.0,0.0,0.0,NULL,1575.0,'17-22/02/2026',NULL),
('FRANCIACORTA','2026-02-25',1130.5,274.5,785.4,0.0,0.0,70.6,0.0,0.0,0.0,0.0,NULL,2145.0,'10-16/02/2026',NULL),
('FRANCIACORTA','2026-02-26',1211.7,222.9,988.8,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-27',2091.55,306.0,1785.55,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-02-28',4199.21,707.21,3373.46,0.0,0.0,118.0,0.0,0.0,0.0,0.0,NULL,0.0,'il versamento di 1.895,00 del 23-28/02 esce dalla cassa il 04/03: registrato sulla chiusura del 04/03 dalla 232','giornata non quadrata sullo specchietto: canali 4198.67 contro corrispettivi+fatture 4199.21');

INSERT INTO public.outlet_daily_closings
  (company_id, outlet_id, closing_date, status, total_receipts, cash_expenses, cash_expenses_note,
   cash_deposit, cash_deposit_note, closed_by_name, notes)
SELECT o.company_id, o.id, s.giorno, 'bozza', s.incasso, s.spese, s.spese_note,
       s.versamento, s.vers_note, 'ricostruzione da specchietto',
       COALESCE(s.nota || ' | ', '') || 'ricostruzione febbraio 2026 dallo specchietto incassi del punto vendita (Drive)'
FROM _stg_incassi_febbraio_fr s
JOIN public.outlets o ON o.name = s.outlet
WHERE NOT EXISTS (SELECT 1 FROM public.outlet_daily_closings c WHERE c.outlet_id = o.id AND c.closing_date = s.giorno);

WITH dati AS (
  SELECT c.id AS closing_id, c.company_id, c.outlet_id, x.label, x.amount
  FROM _stg_incassi_febbraio_fr s
  JOIN public.outlets o ON o.name = s.outlet
  JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date = s.giorno
  CROSS JOIN LATERAL (VALUES ('Contanti', s.contanti), ('POS MPS', s.mps), ('POS MPS Amex', s.mpsx),
                             ('POS BCC', s.bcc), ('POS BCC Amex', s.bccx), ('Pay by link', s.pbl),
                             ('Fatture', s.fatture), ('Bonifico', s.bonifico)) AS x(label, amount)
)
INSERT INTO public.outlet_daily_closing_lines (closing_id, company_id, outlet_id, channel_id, amount)
SELECT d.closing_id, d.company_id, d.outlet_id, ch.id, d.amount
FROM dati d
JOIN public.outlet_payment_channels ch ON ch.outlet_id = d.outlet_id AND ch.label = d.label AND ch.is_active
WHERE NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_lines l WHERE l.closing_id = d.closing_id AND l.channel_id = ch.id);

INSERT INTO public.outlet_daily_closing_expenses (closing_id, company_id, outlet_id, amount, description, kind, sort_order)
SELECT c.id, c.company_id, c.outlet_id, s.spese,
       COALESCE(NULLIF(btrim(s.spese_note), ''), 'spesa di cassa da specchietto'), 'spesa', 1
FROM _stg_incassi_febbraio_fr s
JOIN public.outlets o ON o.name = s.outlet
JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date = s.giorno
WHERE s.spese > 0 AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_expenses e WHERE e.closing_id = c.id);

UPDATE public.outlet_daily_closings c SET updated_at = now()
  FROM public.outlets o WHERE o.id = c.outlet_id AND o.name = 'FRANCIACORTA'
   AND c.closing_date BETWEEN '2026-02-01' AND '2026-02-28';
UPDATE public.outlet_daily_closings c SET status = 'confermata', confirmed_at = now()
  FROM public.outlets o WHERE o.id = c.outlet_id AND o.name = 'FRANCIACORTA'
   AND c.closing_date BETWEEN '2026-02-01' AND '2026-02-28' AND c.status = 'bozza';

COMMIT;

SELECT public.match_cash_closings_with_bank((SELECT id FROM public.companies LIMIT 1), 240, 0.01);

-- Punti 2 e 3: i due versamenti che il motore non puo' trovare
WITH casi(giorno, tx_date, tx_amount, nota) AS (VALUES
  ('2026-02-24','2026-02-24',1575.00,'versato il 24/02 allo sportello ATM 01030-4715 invece del solito 2121 di Franciacorta: il motore riconosce il negozio dalla causale e non lo trova'),
  ('2026-02-25','2026-02-18',2145.00,'versato il 18/02 all''ATM 2121, dichiarato dal negozio sulla giornata del 25/02 con causale "10-16/02": il motore cerca solo in avanti')
), k AS (
  SELECT c.id closing_id, c.company_id, casi.tx_date::date td, casi.tx_amount ta, casi.nota
  FROM casi JOIN public.outlets o ON o.name = 'FRANCIACORTA'
  JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date = casi.giorno::date
), tx AS (
  SELECT k.closing_id, k.company_id, k.td, k.nota, bt.id tx_id, bt.amount
  FROM k JOIN public.bank_transactions bt
    ON bt.company_id = k.company_id AND bt.transaction_date = k.td AND bt.amount = k.ta
   AND public.cash_bank_is_deposit(bt.description)
   AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
)
INSERT INTO public.closing_bank_matches (company_id, closing_id, line_id, bank_transaction_id, amount, match_type, reference_date, note)
SELECT company_id, closing_id, NULL, tx_id, amount, 'versamento', td, nota FROM tx;

WITH somme AS (
  SELECT m.closing_id, sum(m.amount) tot, (min(m.bank_transaction_id::text))::uuid tx
  FROM public.closing_bank_matches m JOIN public.outlet_daily_closings c ON c.id = m.closing_id
  JOIN public.outlets o ON o.id = c.outlet_id
  WHERE m.match_type = 'versamento' AND o.name = 'FRANCIACORTA'
    AND c.closing_date BETWEEN '2026-02-01' AND '2026-02-28' GROUP BY 1)
UPDATE public.outlet_daily_closings c
   SET deposit_bank_status = CASE WHEN abs(s.tot - c.cash_deposit) <= 0.01 THEN 'accreditato' ELSE 'differenza' END,
       deposit_bank_amount = s.tot, deposit_bank_transaction_id = COALESCE(c.deposit_bank_transaction_id, s.tx),
       bank_verified_at = now()
  FROM somme s WHERE s.closing_id = c.id;

SELECT public.match_cash_closings_with_bank((SELECT id FROM public.companies LIMIT 1), 240, 0.01);

SELECT count(*) FROM (
  SELECT public.project_cash_closing_to_daily_revenue(c.id)
  FROM public.outlet_daily_closings c JOIN public.outlets o ON o.id = c.outlet_id
  WHERE o.name = 'FRANCIACORTA' AND c.closing_date BETWEEN '2026-02-01' AND '2026-02-28') t;

-- VERIFICA
-- SELECT count(*) chiusure, sum(total_receipts) incassi, sum(cash_deposit) versamenti
--   FROM public.outlet_daily_closings WHERE closing_date BETWEEN '2026-02-01' AND '2026-02-28';
--   atteso, febbraio completo: 167 | 306664.01 | 59132.15
