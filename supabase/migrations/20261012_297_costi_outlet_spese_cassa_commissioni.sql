-- Migrazione 297 — v_costi_outlet_da_fatture: spese di cassa e commissioni di incasso (12/10/2026)
--
-- Deciso da Patrizio il 12/10/2026. Due costi che non arrivano come fattura ma
-- di cui il negozio è noto entrano nel riquadro «Costi per outlet»:
--   'spese_cassa'         spese pagate in contanti dalla cassa del negozio
--                         (outlet_daily_closings.cash_expenses, chiusure non in bozza),
--                         per data di chiusura;
--   'commissioni_incasso' addebiti in banca delle commissioni Amex e Nexi, con
--                         il negozio letto dal codice nella causale (codice
--                         esercente Amex, Payment Contract Nexi) confrontato con
--                         acquirer_contracts, come in Prima Nota; solo quando il
--                         codice porta a un negozio solo; per data del movimento.
-- Stessa logica di prima per fatture e personale. Vale su ogni tenant.
-- Rollback: rieseguire la 294.

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
  SELECT o.id, o.company_id, o.name, o.cost_center_key FROM public.outlets o
),
cassa AS MATERIALIZED (
  SELECT d.outlet_id, d.closing_date, d.cash_expenses
  FROM public.outlet_daily_closings d
  WHERE coalesce(d.cash_expenses, 0) <> 0 AND coalesce(d.status, '') <> 'bozza'
),
banca AS MATERIALIZED (
  SELECT b.id, b.company_id, b.transaction_date, b.amount, upper(b.description) AS d
  FROM public.bank_transactions b
  WHERE b.amount < 0 AND b.description ~* 'A FAVORE NEXI PAYMENTS|AMERICAN EXPRESS PAYMENTS'
),
contratti AS MATERIALIZED (
  SELECT c.company_id, c.outlet_id,
         CASE WHEN length(trim(c.merchant_code)) >= 8 THEN upper(trim(c.merchant_code)) END AS mc,
         CASE WHEN length(trim(c.payment_contract)) >= 8 THEN upper(trim(c.payment_contract)) END AS pc
  FROM public.acquirer_contracts c
  WHERE c.outlet_id IS NOT NULL
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
GROUP BY 1, 2, 3, 4, 5, 6, 7
UNION ALL
SELECT o.company_id, o.id, o.name, o.cost_center_key,
       EXTRACT(YEAR FROM d.closing_date)::int, EXTRACT(MONTH FROM d.closing_date)::int,
       'spese_cassa'::text, round(sum(d.cash_expenses), 2), 0::bigint
FROM cassa d
JOIN ol o ON o.id = d.outlet_id
GROUP BY 1, 2, 3, 4, 5, 6, 7
UNION ALL
SELECT x.company_id, x.outlet_id, o.name, o.cost_center_key,
       EXTRACT(YEAR FROM x.transaction_date)::int, EXTRACT(MONTH FROM x.transaction_date)::int,
       'commissioni_incasso'::text, round(sum(-x.amount), 2), 0::bigint
FROM (
  SELECT b.id, b.company_id, b.transaction_date, b.amount, min(c.outlet_id::text)::uuid AS outlet_id
  FROM banca b
  JOIN contratti c ON c.company_id = b.company_id
   AND ((c.mc IS NOT NULL AND position(c.mc IN b.d) > 0) OR (c.pc IS NOT NULL AND position(c.pc IN b.d) > 0))
  GROUP BY b.id, b.company_id, b.transaction_date, b.amount
  HAVING count(DISTINCT c.outlet_id) = 1
) x
LEFT JOIN ol o ON o.id = x.outlet_id
GROUP BY 1, 2, 3, 4, 5, 6, 7;

COMMENT ON VIEW public.v_costi_outlet_da_fatture IS
  'Costi per outlet/mese/gruppo: fatture passive ripartite con le regole dei fornitori (invoice_cost_overrides vince), personale e amministratori da v_personnel_gross_cost, spese di cassa delle chiusure (spese_cassa), commissioni Amex e Nexi addebitate in banca (commissioni_incasso). Sola lettura. outlet_id NULL = non assegnato. Esclusi TD16/17/18 e invoice_cost_flags. Migrazioni 285, 290, 291, 293, 294, 297.';
