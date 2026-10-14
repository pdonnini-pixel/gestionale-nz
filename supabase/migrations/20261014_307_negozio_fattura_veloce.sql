-- Migrazione 307 — v_negozio_fattura veloce (14/10/2026)
--
-- Subito dopo la 306 il riquadro «Costi per outlet» impiegava 20 secondi
-- (v_costi_outlet_da_fatture legge v_negozio_fattura). Causa: la 306 cercava
-- il fornitore di ogni fattura con una LATERAL su payables, che non ha un
-- indice su electronic_invoice_id da solo, e la regola attiva con una LATERAL
-- ordinata. Stessa logica con join normali: un DISTINCT ON su payables (hash
-- join) e la regola attiva in join diretto, che è al massimo una per
-- fornitore (indice unico supplier_allocation_rules_one_active_per_supplier).
-- Verificato su NZ: stesse 396 righe della 306, da 19,7 s a pochi ms.
-- Vale su ogni tenant. Rollback: rieseguire la sezione 4 della 306.

CREATE OR REPLACE VIEW public.v_negozio_fattura WITH (security_invoker = on) AS
SELECT ov.company_id, ov.invoice_id, ov.outlet_id, 'classificata'::text AS fonte
FROM public.invoice_cost_overrides ov
UNION ALL
SELECT a.company_id, a.invoice_id, x.outlet_id, x.fonte
FROM public.invoice_outlet_auto a
JOIN (
  SELECT DISTINCT ON (p.electronic_invoice_id) p.electronic_invoice_id, p.supplier_id
  FROM public.payables p
  WHERE p.electronic_invoice_id IS NOT NULL AND p.supplier_id IS NOT NULL
  ORDER BY p.electronic_invoice_id, p.supplier_id
) pf ON pf.electronic_invoice_id = a.invoice_id
JOIN public.suppliers s ON s.id = pf.supplier_id
LEFT JOIN public.cost_categories c ON c.id = s.default_cost_category_id
LEFT JOIN public.supplier_allocation_rules ar ON ar.supplier_id = s.id AND ar.is_active
LEFT JOIN public.invoice_cost_overrides o2 ON o2.invoice_id = a.invoice_id
CROSS JOIN LATERAL (
  SELECT CASE
           WHEN c.code = 'ENERG_GAS' AND a.outlet_contatore IS NOT NULL THEN a.outlet_contatore
           WHEN c.code = 'VIAGGI' AND a.outlet_luogo IS NOT NULL THEN a.outlet_luogo
           ELSE a.outlet_nominato END AS outlet_id,
         CASE
           WHEN c.code = 'ENERG_GAS' AND a.outlet_contatore IS NOT NULL THEN 'contatore'
           WHEN c.code = 'VIAGGI' AND a.outlet_luogo IS NOT NULL THEN 'luogo'
           ELSE 'nominato' END AS fonte
) x
WHERE x.outlet_id IS NOT NULL
  AND o2.invoice_id IS NULL
  AND coalesce(nullif(s.cost_center, ''), 'all') = 'all'
  AND (ar.description IS NULL OR (ar.created_by IS NULL AND ar.description LIKE 'Automatica:%'))
  AND coalesce(ar.description, '') NOT LIKE 'Automatica: merce%'
  AND coalesce(ar.description, '') NOT LIKE 'Automatica: mezzi%'
  AND coalesce(c.code, '') NOT IN ('ACQ_MERCE', 'ACCESSORI_ABB_TO', 'MEZZI_E_CARBURANTE');

COMMENT ON VIEW public.v_negozio_fattura IS
  'Negozio di una singola fattura passiva: classificazione a mano (invoice_cost_overrides), altrimenti outlet letto dal documento (invoice_outlet_auto) per i fornitori a riparto automatico, merce e carburante esclusi. Senza riga vale il riparto del fornitore. Usata da v_costi_outlet_da_fatture e dalla colonna Negozio della Prima Nota. Migrazioni 306, 307.';
