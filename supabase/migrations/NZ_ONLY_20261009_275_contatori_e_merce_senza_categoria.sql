-- NZ_ONLY Migrazione 275 — punti di fornitura letti dalle bollette e merce
-- fra i fornitori senza categoria (09/10/2026)
--
-- 1. utility_supply_points: POD/PDR → outlet. Fonte: indirizzo di fornitura
--    stampato nel PDF della bolletta ENEGAN («Dati identificativi della
--    fornitura») o, per Enel, la sede di fornitura nel blocco cliente della
--    fattura. Il PDR gas HERA 03050000126920 non riporta l'indirizzo: resta
--    fuori finché non si sa dov'è.
-- 2. Fornitori senza categoria le cui fatture sono abbigliamento o accessori
--    (righe lette una per una): regola merce come il preventivo acquisti,
--    decisa da Patrizio il 09/10/2026 (ITX compreso). La descrizione inizia per
--    «Automatica: merce», così il riparto notturno ne aggiorna le quote.
-- Aggancio fornitori per P.IVA, outlet per cost_center_key. Solo INSERT.

INSERT INTO public.utility_supply_points (company_id, code, outlet_id, address, source)
SELECT o.company_id, m.code, o.id, m.address, m.source
FROM (VALUES
  ('IT001E02597870', 'brugnato',       'Brugnato (SP), Via Antica Romana snc',                     'bolletta ENEGAN (PDF)'),
  ('IT001E41637858', 'valdichiana',    'Foiano della Chiana (AR), Via Farniole snc',               'bolletta ENEGAN (PDF)'),
  ('IT001E33739236', 'palmanova',      'Aiello del Friuli (UD), Strada Provinciale 126 snc',       'bolletta ENEGAN (PDF)'),
  ('IT001E18191803', 'franciacorta',   'Rodengo Saiano (BS), Piazza Cascina Moie 12',              'bolletta ENEGAN (PDF)'),
  ('IT001E41850319', 'sede_magazzino', 'Figline e Incisa Valdarno (FI), Via Borratino Lallerempoli 44', 'bolletta ENEGAN (PDF)'),
  ('IT001E42807603', 'barberino',      'Barberino di Mugello (FI), Via Antonio Meucci snc',        'bolletta ENEGAN (PDF)'),
  ('IT001E61326147', 'valmontone',     'Valmontone (RM), Località Pascolaro snc',                  'bolletta ENEGAN (PDF)'),
  ('IT001E12117455', 'torino',         'Settimo Torinese (TO), Via Torino 160',                    'fattura Enel (sede di fornitura)'),
  ('IT001E12310445', 'sede_magazzino', 'Reggello (FI), Loc. Pian di Rona 120B',                    'fattura Enel (sede di fornitura)'),
  ('15964204284446', 'barberino',      'Barberino di Mugello (FI), Via Antonio Meucci 1 (gas)',    'fattura Enel (sede di fornitura)')
) AS m(code, cc_key, address, source)
JOIN public.outlets o ON o.cost_center_key = m.cc_key AND o.is_active
ON CONFLICT (company_id, code) DO NOTHING;

DO $$
DECLARE
  r record;
  v_rule uuid;
  v_year int := EXTRACT(YEAR FROM (now() AT TIME ZONE 'Europe/Rome'))::int;
BEGIN
  FOR r IN
    SELECT s.id, s.company_id, s.name
    FROM public.suppliers s
    WHERE s.vat_number IN ('03507621211',  -- S.B.A.: camicie, gonne, pantaloni
                           '02400710972',  -- My Dream: maglie, giacche
                           '02049930973',  -- Marf: camicie, pareo
                           '02262820976',  -- Più Forty: occhiali da sole
                           '02590880973',  -- Bella Bijoux: bigiotteria
                           '01251100432',  -- E.M. Company: cinture
                           '06197930487',  -- Xiaohui Hu: anelli, orecchini, collane
                           '11209550158')  -- ITX Italia: vestiti, camicie (merce, deciso da Patrizio)
      AND coalesce(nullif(s.cost_center, ''), 'all') = 'all'
      AND NOT EXISTS (SELECT 1 FROM public.supplier_allocation_rules ar WHERE ar.supplier_id = s.id AND ar.is_active)
  LOOP
    INSERT INTO public.supplier_allocation_rules (company_id, supplier_id, allocation_mode, description, is_active)
    VALUES (r.company_id, r.id, 'SPLIT_PCT',
            format('Automatica: merce ripartita come il preventivo acquisti %s (abbigliamento/accessori dalle righe fattura, migrazione 275)', v_year),
            true)
    RETURNING id INTO v_rule;

    INSERT INTO public.supplier_allocation_details (rule_id, outlet_id, percentage)
    WITH p AS (
      SELECT o.id AS outlet_id, sum(be.budget_amount) AS a
      FROM public.budget_entries be
      JOIN public.chart_of_accounts c ON c.code = be.account_code AND c.company_id = be.company_id
      JOIN public.outlets o ON o.company_id = be.company_id AND o.cost_center_key = be.cost_center AND o.is_active
      WHERE be.company_id = r.company_id AND be.year = v_year
        AND be.is_placeholder IS NOT TRUE
        AND c.macro_group = 'costi_produzione'
        AND be.cost_center NOT IN ('all', 'rettifica_bilancio')
      GROUP BY o.id
      HAVING sum(be.budget_amount) > 0
    ),
    q AS (
      SELECT outlet_id, a, round(100 * a / sum(a) OVER (), 2) AS pct,
             row_number() OVER (ORDER BY a DESC, outlet_id) AS rn
      FROM p
    )
    SELECT v_rule, outlet_id, CASE WHEN rn = 1 THEN pct + (100 - sum(pct) OVER ()) ELSE pct END
    FROM q;
  END LOOP;
END $$;
