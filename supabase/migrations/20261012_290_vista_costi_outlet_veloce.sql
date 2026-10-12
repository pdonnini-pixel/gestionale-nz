-- Migrazione 290 — v_costi_outlet_da_fatture più veloce (12/10/2026)
--
-- In Confronto Outlet il riquadro «Costi da fatture» andava in timeout
-- («canceling statement due to statement timeout»): il pianificatore stimava
-- 1 riga per le fatture filtrate per anno e ricalcolava le quote di riparto
-- una volta per fattura (1.432 volte, 3,3 milioni di letture, 6,5 s).
-- Le due CTE diventano MATERIALIZED: calcolate una volta sola (0,26 s su NZ).
-- Stessa logica, stesse colonne della 285; security_invoker resta on.
-- Vale su ogni tenant.

CREATE OR REPLACE VIEW public.v_costi_outlet_da_fatture WITH (security_invoker = on) AS
WITH inv AS MATERIALIZED (
  SELECT DISTINCT ON (e.id) e.id AS invoice_id, e.company_id, e.invoice_date, p.supplier_id,
         CASE WHEN e.tipo_documento = 'TD04' THEN -abs(coalesce(e.net_amount, 0)) ELSE coalesce(e.net_amount, 0) END AS netto
  FROM public.electronic_invoices e
  LEFT JOIN public.payables p ON p.electronic_invoice_id = e.id
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
)
SELECT i.company_id,
       q.outlet_id,
       o.name AS outlet,
       o.cost_center_key,
       EXTRACT(YEAR FROM i.invoice_date)::int AS anno,
       EXTRACT(MONTH FROM i.invoice_date)::int AS mese,
       CASE WHEN i.supplier_id IS NULL THEN 'senza_fornitore'
            WHEN c.code = 'ALLESTIMENTI' THEN 'allestimenti'
            ELSE coalesce(c.macro_group::text, 'senza_categoria') END AS gruppo,
       round(sum(i.netto * coalesce(q.pct, 100) / 100), 2) AS importo,
       count(DISTINCT i.invoice_id) AS fatture
FROM inv i
LEFT JOIN public.suppliers s ON s.id = i.supplier_id
LEFT JOIN public.cost_categories c ON c.id = s.default_cost_category_id
LEFT JOIN quote q ON q.supplier_id = i.supplier_id
LEFT JOIN public.outlets o ON o.id = q.outlet_id
WHERE i.invoice_date IS NOT NULL
GROUP BY 1, 2, 3, 4, 5, 6, 7;

COMMENT ON VIEW public.v_costi_outlet_da_fatture IS
  'Costi da fatture passive per outlet/mese/gruppo, ripartiti con le regole dei fornitori. Sola lettura. outlet_id NULL = non assegnato. Esclusi TD16/17/18 e invoice_cost_flags. Migrazioni 285, 290.';
