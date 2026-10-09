-- NZ_ONLY Migrazione 276 — città degli outlet, dove mancava
--
-- Le fatture dei fornitori indicano spesso la consegna con il paese
-- («destinazione: Rodengo», «Foiano», «Aiello del Friuli»), non con il nome
-- dell'outlet. outlets.city era vuoto per quasi tutti i punti vendita: lo si
-- riempie con il comune dell'indirizzo di fornitura letto dalle bollette
-- (utility_supply_points, migrazione 275). Solo dove city è vuoto: un valore
-- già scritto non si tocca.

UPDATE public.outlets o SET city = m.city
FROM (VALUES
  ('valdichiana',  'Foiano della Chiana'),
  ('palmanova',    'Aiello del Friuli'),
  ('franciacorta', 'Rodengo Saiano'),
  ('barberino',    'Barberino di Mugello'),
  ('brugnato',     'Brugnato'),
  ('valmontone',   'Valmontone')
) AS m(cc_key, city)
WHERE o.cost_center_key = m.cc_key
  AND coalesce(o.city, '') = '';
