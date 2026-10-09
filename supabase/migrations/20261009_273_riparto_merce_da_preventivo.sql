-- Migrazione 273 — riparto degli acquisti di merce in proporzione al preventivo
--
-- Deciso da Patrizio il 09/10/2026: le fatture della merce non nominano
-- l'outlet (la merce arriva al magazzino centrale), quindi si ripartisce in
-- proporzione al preventivo acquisti dell'anno («come da budget»). Un outlet
-- in apertura con preventivo acquisti (es. scorta iniziale) entra nella
-- ripartizione: anche il suo numero è un previsionale, come i ricavi.
--
-- Cosa fa (solo INSERT):
--   per ogni fornitore con categoria di default «Acquisto merce» (ACQ_MERCE),
--   centro di costo «tutti» o vuoto e NESSUNA regola di riparto attiva,
--   crea una regola SPLIT_PCT con, per ogni outlet, la sua quota del
--   preventivo acquisti dell'anno in corso: budget_entries dei conti con
--   macro_group 'costi_produzione', escluse le righe segnaposto, la Sede /
--   costi generali ('all') e la rettifica bilancio. Percentuali a due
--   decimali, l'arrotondamento residuo va sull'outlet con la quota maggiore,
--   così il totale è esattamente 100.
-- Le quote sono una fotografia del preventivo di oggi: se il preventivo
-- cambia, si aggiornano dalla scheda Fornitori → Riparto.
-- Nessun nome, id o P.IVA scritto a mano: vale su ogni tenant; senza
-- preventivo acquisti o senza fornitori di merce non fa nulla.
-- Provenienza: description «Automatica: …», created_by NULL.

DO $$
DECLARE
  v_company uuid;
  v_year int := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  s record;
  v_rule uuid;
  v_n int;
BEGIN
  FOR v_company IN SELECT DISTINCT company_id FROM public.suppliers LOOP
    -- C'è un preventivo acquisti per outlet in quest'anno?
    SELECT count(DISTINCT o.id) INTO v_n
    FROM public.budget_entries be
    JOIN public.chart_of_accounts c ON c.code = be.account_code AND c.company_id = be.company_id
    JOIN public.outlets o ON o.company_id = be.company_id AND o.cost_center_key = be.cost_center AND o.is_active
    WHERE be.company_id = v_company AND be.year = v_year
      AND be.is_placeholder IS NOT TRUE
      AND c.macro_group = 'costi_produzione'
      AND be.cost_center NOT IN ('all', 'rettifica_bilancio')
      AND be.budget_amount > 0;
    CONTINUE WHEN v_n = 0;

    FOR s IN
      SELECT sp.id, sp.name
      FROM public.suppliers sp
      JOIN public.cost_categories cc ON cc.id = sp.default_cost_category_id
      WHERE sp.company_id = v_company
        AND cc.code = 'ACQ_MERCE'
        AND coalesce(nullif(sp.cost_center, ''), 'all') = 'all'
        AND NOT EXISTS (SELECT 1 FROM public.supplier_allocation_rules ar
                         WHERE ar.supplier_id = sp.id AND ar.is_active)
    LOOP
      INSERT INTO public.supplier_allocation_rules (company_id, supplier_id, allocation_mode, description, is_active)
      VALUES (v_company, s.id, 'SPLIT_PCT',
              format('Automatica: merce ripartita come il preventivo acquisti %s (migrazione 273)', v_year),
              true)
      RETURNING id INTO v_rule;

      INSERT INTO public.supplier_allocation_details (rule_id, outlet_id, percentage)
      WITH p AS (
        SELECT o.id AS outlet_id, sum(be.budget_amount) AS a
        FROM public.budget_entries be
        JOIN public.chart_of_accounts c ON c.code = be.account_code AND c.company_id = be.company_id
        JOIN public.outlets o ON o.company_id = be.company_id AND o.cost_center_key = be.cost_center AND o.is_active
        WHERE be.company_id = v_company AND be.year = v_year
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
      SELECT v_rule, outlet_id,
             CASE WHEN rn = 1 THEN pct + (100 - sum(pct) OVER ()) ELSE pct END
      FROM q;

      RAISE NOTICE 'Regola SPLIT_PCT merce: %', s.name;
    END LOOP;
  END LOOP;
END $$;
