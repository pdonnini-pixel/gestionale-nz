-- =====================================================================
-- NZ_ONLY 398 — Roma Soratte, chiusura di domenica 08/11/2026:
--               229,62 euro di Amex scritti nella colonna del POS
-- ---------------------------------------------------------------------
-- Richiesta di Patrizio dell'11/11/2026 («sistema la chiusura»).
--
-- Dichiarato in chiusura:  POS MPS 26.142,31   POS MPS Amex   871,72
-- Accreditato da MPS
-- (terminale 00016,
--  data rif. 08.11.26):    Bancomat + circuiti 25.722,68   Amex 1.101,34
--
-- L'Amex e' accreditato al lordo (07/11: dichiarato 162,07, accreditato
-- 162,07), quindi l'Amex vero della giornata e' 1.101,34: 229,62 in piu'
-- del dichiarato. La foto in chiusura mostra un solo scontrino del POS
-- (16.432,69, con Amex 871,72) su 27.014,03 di carte dichiarate: l'Amex
-- dell'altra chiusura del POS e' finito nella colonna «POS MPS».
-- Spostati i 229,62:
--
--   POS MPS       26.142,31 -> 25.912,69  (accreditato 25.722,68, -0,73%,
--                                          la trattenuta degli altri giorni)
--   POS MPS Amex     871,72 ->  1.101,34  (accreditato 1.101,34, esatto)
--
-- Il totale delle carte (27.014,03) e il totale della giornata (31.205,68)
-- non cambiano: corrispettivi, contanti e ricavo del giorno restano uguali.
-- Lo stato della chiusura non cambia, quindi non parte nessuna mail.
--
-- NO DATA LOSS: tre UPDATE, ciascuno solo se trova il valore di partenza.
-- I valori dichiarati dalle cassiere restano scritti qui e nella nota
-- della chiusura. Solo NZ.
-- =====================================================================

BEGIN;

UPDATE public.outlet_daily_closing_lines l
   SET amount = CASE ch.label WHEN 'POS MPS' THEN 25912.69 ELSE 1101.34 END,
       updated_at = now()
  FROM public.outlet_daily_closings c, public.outlets o, public.outlet_payment_channels ch
 WHERE l.closing_id = c.id AND c.outlet_id = o.id AND ch.id = l.channel_id
   AND o.code = 'RSO' AND c.closing_date = DATE '2026-11-08'
   AND ((ch.label = 'POS MPS' AND l.amount = 26142.31)
     OR (ch.label = 'POS MPS Amex' AND l.amount = 871.72));

UPDATE public.outlet_daily_closings c
   SET notes = concat_ws(' | ', NULLIF(btrim(c.notes), ''),
       '11/11/2026: spostati 229,62 euro da POS MPS (dichiarato 26.142,31) a POS MPS Amex (dichiarato 871,72), perche'' MPS ha accreditato 1.101,34 di Amex per l''08/11. Richiesta di Patrizio.')
  FROM public.outlets o
 WHERE c.outlet_id = o.id AND o.code = 'RSO' AND c.closing_date = DATE '2026-11-08'
   AND COALESCE(c.notes, '') NOT LIKE '%spostati 229,62%';

-- L'accredito Amex di 1.101,34 era gia' abbinato, ma alla riga «POS MPS»:
-- il 09/11 non valeva quanto l'Amex dichiarato e il riscontro lo aveva
-- lasciato nel mucchio del terminale. Si sposta l'abbinamento sulla riga
-- Amex (UPDATE di una riga, niente si cancella); il riscontro ricalcola
-- poi gli esiti delle due righe.
UPDATE public.closing_bank_matches m
   SET line_id = la.id, match_type = 'amex',
       note = concat_ws(' | ', m.note, 'spostato sulla riga Amex l''11/11/2026 (398)')
  FROM public.outlet_daily_closings c, public.outlets o,
       public.outlet_daily_closing_lines la, public.outlet_payment_channels cha,
       public.bank_transactions bt
 WHERE m.closing_id = c.id AND c.outlet_id = o.id
   AND o.code = 'RSO' AND c.closing_date = DATE '2026-11-08'
   AND la.closing_id = c.id AND cha.id = la.channel_id AND cha.label = 'POS MPS Amex'
   AND la.amount = 1101.34
   AND bt.id = m.bank_transaction_id AND bt.amount = 1101.34
   AND bt.description ~ 'CIRCUITO: AMEX'
   AND m.match_type = 'pos';

COMMIT;

-- Dopo l'applicazione: SELECT public.match_cash_closings_with_bank();
