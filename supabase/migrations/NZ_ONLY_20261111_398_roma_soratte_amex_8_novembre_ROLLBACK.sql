-- =====================================================================
-- ROLLBACK della NZ_ONLY 398 — la chiusura di Roma dell'08/11/2026 torna
-- ai valori dichiarati dalle cassiere. La nota resta, con una riga in piu'.
-- Dopo il rollback rilanciare: SELECT public.match_cash_closings_with_bank();
-- =====================================================================

BEGIN;

UPDATE public.outlet_daily_closing_lines l
   SET amount = CASE ch.label WHEN 'POS MPS' THEN 26142.31 ELSE 871.72 END,
       updated_at = now()
  FROM public.outlet_daily_closings c, public.outlets o, public.outlet_payment_channels ch
 WHERE l.closing_id = c.id AND c.outlet_id = o.id AND ch.id = l.channel_id
   AND o.code = 'RSO' AND c.closing_date = DATE '2026-11-08'
   AND ((ch.label = 'POS MPS' AND l.amount = 25912.69)
     OR (ch.label = 'POS MPS Amex' AND l.amount = 1101.34));

UPDATE public.outlet_daily_closings c
   SET notes = concat_ws(' | ', NULLIF(btrim(c.notes), ''), 'Spostamento dei 229,62 euro annullato: tornati i valori dichiarati.')
  FROM public.outlets o
 WHERE c.outlet_id = o.id AND o.code = 'RSO' AND c.closing_date = DATE '2026-11-08'
   AND c.notes LIKE '%spostati 229,62%';

UPDATE public.closing_bank_matches m
   SET line_id = lp.id, match_type = 'pos',
       note = concat_ws(' | ', m.note, 'riportato sulla riga POS MPS')
  FROM public.outlet_daily_closings c, public.outlets o,
       public.outlet_daily_closing_lines lp, public.outlet_payment_channels chp
 WHERE m.closing_id = c.id AND c.outlet_id = o.id
   AND o.code = 'RSO' AND c.closing_date = DATE '2026-11-08'
   AND lp.closing_id = c.id AND chp.id = lp.channel_id AND chp.label = 'POS MPS'
   AND m.match_type = 'amex' AND m.amount = 1101.34
   AND m.note LIKE '%(398)%';

COMMIT;
