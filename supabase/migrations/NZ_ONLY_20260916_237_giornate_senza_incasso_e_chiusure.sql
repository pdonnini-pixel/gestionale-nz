-- NZ_ONLY_20260916_237_giornate_senza_incasso_e_chiusure.sql
--
-- PERCHE'
-- La ricostruzione degli incassi 2026 (migration 223-233) saltava le righe degli specchietti
-- che valevano zero. Sedici giornate esistono sul foglio del negozio e non nel gestionale:
-- la griglia di Incassi giornalieri le mostra come un trattino, indistinguibili da un dato
-- non ancora inserito. Nessun euro in gioco, ma sedici vuoti che sembrano lavoro da fare.
--
-- LE FONTI, per ogni giornata
-- 1. Specchietto del negozio su Drive: la riga c'e', e dice '0,00' oppure 'CHIUSO'.
-- 2. Estratto conto: nessun accredito POS con quella data di vendita, da nessun terminale.
-- 3. Registri corrispettivi dell'Agenzia delle Entrate, verificati da Sabrina il 16/09/2026:
--    - Brugnato 10/02 e 19/03: nessun incasso, GIORNATE LAVORATIVE;
--    - Barberino 06/01: chiuso, e' la Befana.
--
-- COSA SCRIVE
-- a) Giornate di chiusura (is_closed_day = true): 01/01 (Capodanno), 06/01 (Befana),
--    05/04 (Pasqua). Il frontend le mostra come «chiuso» e le tiene fuori dal conto del mese.
-- b) Giornate lavorative senza incasso (is_closed_day = false, importi a zero):
--    Brugnato 10/02 e 19/03. Contano fra i giorni di apertura, come ha chiesto Sabrina.
--
-- Additiva: nessuna riga esistente viene toccata o cancellata. Ogni INSERT e' protetto da
-- NOT EXISTS, quindi rilanciarla non crea doppioni. Nessun UUID scritto a mano: i negozi si
-- ricavano per nome e l'azienda dalla riga del negozio. Per ogni giorno si prendono solo i
-- punti vendita che quel mese erano gia' operativi (chi non ha chiusure nel mese resta fuori,
-- cosi' Torino non compare a gennaio e compare ad aprile).
--
-- Le righe scritte portano il marcatore in `notes`, che serve al ROLLBACK per riconoscerle.

BEGIN;

-- a) Le tre giornate di chiusura
INSERT INTO public.outlet_daily_closings
  (company_id, outlet_id, closing_date, status, is_closed_day, notes)
SELECT o.company_id, o.id, g.giorno, 'confermata', true, 'chiusura-237'
  FROM public.outlets o
 CROSS JOIN (VALUES ('2026-01-01'::date), ('2026-01-06'::date), ('2026-04-05'::date)) AS g(giorno)
 WHERE o.is_active
   AND EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                WHERE c.outlet_id = o.id
                  AND date_trunc('month', c.closing_date) = date_trunc('month', g.giorno))
   AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                    WHERE c.outlet_id = o.id AND c.closing_date = g.giorno);

-- b) Le due giornate lavorative di Brugnato senza incasso
INSERT INTO public.outlet_daily_closings
  (company_id, outlet_id, closing_date, status, is_closed_day, notes)
SELECT o.company_id, o.id, g.giorno, 'confermata', false, 'chiusura-237'
  FROM public.outlets o
 CROSS JOIN (VALUES ('2026-02-10'::date), ('2026-03-19'::date)) AS g(giorno)
 WHERE o.name = 'BRUGNATO'
   AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                    WHERE c.outlet_id = o.id AND c.closing_date = g.giorno);

COMMIT;

-- VERIFICA (deve tornare 16 righe: 14 chiuse e 2 lavorative a zero)
-- SELECT o.name, c.closing_date, c.is_closed_day, c.total_receipts
--   FROM public.outlet_daily_closings c JOIN public.outlets o ON o.id = c.outlet_id
--  WHERE c.notes = 'chiusura-237' ORDER BY c.closing_date, o.name;
--
-- CONTROLLO DI COPERTURA, quello che resta buono nel tempo. Deve tornare zero righe.
-- Per ogni punto vendita guarda solo i giorni dalla sua prima chiusura in poi, altrimenti
-- segnalerebbe come buchi i mesi in cui il negozio non aveva ancora aperto (Torino prima del
-- 26/03/2026). Una riga qui significa: giornata che nessuno ha compilato, da recuperare.
-- WITH vita AS (
--   SELECT o.id, o.name, min(c.closing_date) AS dal
--     FROM public.outlets o JOIN public.outlet_daily_closings c ON c.outlet_id = o.id
--    WHERE o.is_active GROUP BY 1, 2)
-- SELECT v.name, d::date AS giorno_scoperto
--   FROM vita v CROSS JOIN LATERAL generate_series(v.dal, current_date - 1, '1 day') d
--  WHERE NOT EXISTS (SELECT 1 FROM public.outlet_daily_closings c
--                     WHERE c.outlet_id = v.id AND c.closing_date = d::date)
--  ORDER BY 2, 1;
