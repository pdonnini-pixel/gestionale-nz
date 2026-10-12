-- Migrazione 294 — v_costi_outlet_da_fatture: colonna Personale (12/10/2026)
--
-- Alle fatture si aggiungono le righe del costo del personale, gruppo
-- 'personale', lette da v_personnel_gross_cost (Prospetto dello studio paghe,
-- Dipendenti → Costo lordo). Importo = costo_lordo_outlet, la stessa formula
-- decisa da Lilian e mostrata in Dipendenti: totale retribuzioni − compensi
-- amministratori + INPS, EBINTER, EST + INAIL (imponibile × tasso) + TFR a fondo.
-- Gli amministratori (compensi + INPS gestione separata) sono un gruppo a parte,
-- 'amministratori', fuori dal costo del personale come in Dipendenti.
-- Il personale sta sull'outlet della filiale (la sede resta alla sede);
-- filiale senza outlet = non assegnato. fatture = 0 per queste righe.
-- Vale su ogni tenant. Rollback: rieseguire la 293.

CREATE OR REPLACE VIEW public.v_costi_outlet_da_fatture WITH (security_invoker = on) AS
WITH inv AS MATERIALIZED (
  SELECT DISTINCT ON (e.id) e.id AS invoice_id, e.company_id, e.invoice_date, p.supplier_id,
         CASE WHEN e.tipo_documento = 'TD04' THEN -abs(coalesce(e.net_amount, 0)) ELSE coalesce(e.net_amount, 0) END AS netto,
         ov.outlet_id AS ov_outlet, ov.gruppo AS ov_gruppo
  FROM public.electronic_invoices e
  LEFT JOIN public.payables p ON p.electronic_invoice_id = e.id
  LEFT JOIN public.invoice_cost_overrides ov ON ov.invoice_id = e.id
  WHERE coalesce(e.tipo_documento, 'TD01') NOT IN ('TD16', 'TD17', 'TD18')
    AND NOT EXISTS (SELECT 1 FROM public.invoice_cost_flags f WHERE f.invoice_id = e.id)
  ORDER BY e.id, p.supplier_id NULLS LAST
),
quote AS MATERIALIZED (
  SELECT s.id AS supplier_id, o.id AS outlet_id, 100::numeric AS pct
  FROM public.suppliers s
  JOIN public.outlets o ON o.company_id = s.company_id AND o.cost_center_key = s.cost_center
  WHERE coalesce(nullif(s.cost_center, ''), 'all') <> 'all'
  UNION ALL
  SELECT r.supplier_id, d.outlet_id, d.percentage
  FROM public.supplier_allocation_rules r
  JOIN public.supplier_allocation_details d ON d.rule_id = r.id
  JOIN public.suppliers s ON s.id = r.supplier_id
  WHERE r.is_active AND coalesce(nullif(s.cost_center, ''), 'all') = 'all'
),
ol AS MATERIALIZED (
  SELECT o.id, o.name, o.cost_center_key FROM public.outlets o
)
SELECT i.company_id,
       coalesce(i.ov_outlet, q.outlet_id) AS outlet_id,
       o.name AS outlet,
       o.cost_center_key,
       EXTRACT(YEAR FROM i.invoice_date)::int AS anno,
       EXTRACT(MONTH FROM i.invoice_date)::int AS mese,
       CASE WHEN i.ov_gruppo IS NOT NULL THEN i.ov_gruppo
            WHEN i.supplier_id IS NULL THEN 'senza_fornitore'
            WHEN c.code = 'ALLESTIMENTI' THEN 'allestimenti'
            ELSE coalesce(c.macro_group::text, 'senza_categoria') END AS gruppo,
       round(sum(i.netto * CASE WHEN i.ov_outlet IS NOT NULL THEN 100 ELSE coalesce(q.pct, 100) END / 100), 2) AS importo,
       count(DISTINCT i.invoice_id) AS fatture
FROM inv i
LEFT JOIN public.suppliers s ON s.id = i.supplier_id
LEFT JOIN public.cost_categories c ON c.id = s.default_cost_category_id
LEFT JOIN quote q ON i.ov_outlet IS NULL AND q.supplier_id = i.supplier_id
LEFT JOIN ol o ON o.id = coalesce(i.ov_outlet, q.outlet_id)
WHERE i.invoice_date IS NOT NULL
GROUP BY 1, 2, 3, 4, 5, 6, 7
UNION ALL
SELECT g.company_id,
       g.outlet_id,
       o.name AS outlet,
       o.cost_center_key,
       g.year AS anno,
       g.month AS mese,
       x.gruppo,
       round(sum(x.importo), 2) AS importo,
       0::bigint AS fatture
FROM public.v_personnel_gross_cost g
CROSS JOIN LATERAL (VALUES ('personale'::text, g.costo_lordo_outlet),
                           ('amministratori'::text, g.amministratori_totale)) x(gruppo, importo)
LEFT JOIN ol o ON o.id = g.outlet_id
WHERE x.importo <> 0
GROUP BY 1, 2, 3, 4, 5, 6, 7;

COMMENT ON VIEW public.v_costi_outlet_da_fatture IS
  'Costi da fatture passive per outlet/mese/gruppo, ripartiti con le regole dei fornitori; invoice_cost_overrides vince per la singola fattura. Più il costo del personale (gruppo personale, costo_lordo_outlet di v_personnel_gross_cost, gruppo amministratori a parte). Sola lettura. outlet_id NULL = non assegnato. Esclusi TD16/17/18 e invoice_cost_flags. Migrazioni 285, 290, 291, 293, 294.';
