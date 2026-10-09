-- NZ_ONLY Migrazione 280 — contatore gas HERA e luoghi delle trasferte (09/10/2026)
--
-- 1. PDR HERA 03050000126920: il PDF allegato alla bolletta (sezione «Servizio
--    fornito in») riporta Via Borratino Vallerempoli 44, Figline e Incisa
--    Valdarno: lo stesso indirizzo del POD IT001E41850319 della sede/magazzino.
-- 2. outlet_travel_places (migrazione 279): luoghi che identificano ogni
--    outlet per trasferte e pasti. Comuni letti nelle righe delle fatture
--    (stazioni dei treni, alberghi, ristoranti) e province dei fornitori
--    lontani dalla sede. Roma e Firenze NON sono luoghi: sono la partenza dei
--    viaggi o città con più punti (Valmontone e Roma Soratte sono entrambi RM).
-- 3. Categoria VIAGGI ai fornitori di viaggio che non ne avevano una (treni,
--    alberghi, ristoranti): solo dove la categoria è vuota.
-- Outlet per cost_center_key, fornitori per P.IVA. Solo INSERT e riempimento
-- di campi vuoti.

INSERT INTO public.utility_supply_points (company_id, code, outlet_id, address, source)
SELECT o.company_id, '03050000126920', o.id,
       'Figline e Incisa Valdarno (FI), Via Borratino Vallerempoli 44 (gas)', 'bolletta HERA (PDF, «Servizio fornito in»)'
FROM public.outlets o
WHERE o.cost_center_key = 'sede_magazzino' AND o.is_active
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO public.outlet_travel_places (company_id, outlet_id, kind, place, note)
SELECT o.company_id, o.id, p.kind, p.place, 'deciso da Patrizio il 09/10/2026 (migrazione 280)'
FROM (VALUES
  ('barberino',    'comune',    'barberino'),
  ('brugnato',     'comune',    'brugnato'),
  ('valmontone',   'comune',    'valmontone'),
  ('roma_soratte', 'comune',    'sant''oreste'),
  ('valdichiana',  'comune',    'valdichiana'),
  ('valdichiana',  'comune',    'foiano'),
  ('valdichiana',  'comune',    'cortona'),
  ('valdichiana',  'comune',    'camucia'),
  ('franciacorta', 'comune',    'rodengo'),
  ('franciacorta', 'comune',    'franciacorta'),
  ('franciacorta', 'comune',    'erbusco'),
  ('franciacorta', 'comune',    'brescia'),
  ('palmanova',    'comune',    'palmanova'),
  ('palmanova',    'comune',    'aiello'),
  ('palmanova',    'comune',    'cervignano'),
  ('torino',       'comune',    'torino'),
  ('torino',       'comune',    'settimo torinese'),
  ('palmanova',    'provincia', 'UD'),
  ('torino',       'provincia', 'TO'),
  ('franciacorta', 'provincia', 'BS'),
  ('brugnato',     'provincia', 'SP')
) AS p(cc_key, kind, place)
JOIN public.outlets o ON o.cost_center_key = p.cc_key AND o.is_active
ON CONFLICT (company_id, kind, place) DO NOTHING;

UPDATE public.suppliers s
SET default_cost_category_id = c.id
FROM public.cost_categories c
WHERE c.company_id = s.company_id AND c.code = 'VIAGGI'
  AND s.default_cost_category_id IS NULL
  AND s.vat_number IN ('05403151003',  -- Trenitalia
                       '09247981005',  -- Italo
                       '02538160033',  -- Autogrill
                       '06291950969',  -- B&B Hotels Italia
                       '03740360379',  -- Hotel Gross, Bentivoglio
                       '00823710116'); -- Ristorante dell'Autista, Brugnato
