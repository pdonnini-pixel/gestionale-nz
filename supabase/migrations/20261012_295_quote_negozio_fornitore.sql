-- Migrazione 295 — v_quote_negozio_fornitore (12/10/2026)
--
-- A quale negozio va ogni fornitore, con le stesse quote del riparto di
-- v_costi_outlet_da_fatture: centro di costo del fornitore (100%) oppure la
-- regola di riparto attiva. Serve alla colonna «Negozio» della Prima Nota,
-- chiesta dallo studio (Monica, 08/10/2026) per non registrare al magazzino
-- spese che sono di un negozio. Sola lettura, nessun dato scritto.
-- Vale su ogni tenant. Rollback: DROP VIEW public.v_quote_negozio_fornitore.

CREATE OR REPLACE VIEW public.v_quote_negozio_fornitore WITH (security_invoker = on) AS
SELECT s.company_id, s.id AS supplier_id, o.id AS outlet_id, 100::numeric AS pct
FROM public.suppliers s
JOIN public.outlets o ON o.company_id = s.company_id AND o.cost_center_key = s.cost_center
WHERE coalesce(nullif(s.cost_center, ''), 'all') <> 'all'
UNION ALL
SELECT r.company_id, r.supplier_id, d.outlet_id, d.percentage AS pct
FROM public.supplier_allocation_rules r
JOIN public.supplier_allocation_details d ON d.rule_id = r.id
JOIN public.suppliers s ON s.id = r.supplier_id
WHERE r.is_active AND coalesce(nullif(s.cost_center, ''), 'all') = 'all';

COMMENT ON VIEW public.v_quote_negozio_fornitore IS
  'Quote per negozio di ogni fornitore (centro di costo al 100% o regola di riparto attiva), come in v_costi_outlet_da_fatture. Usata dalla colonna Negozio della Prima Nota. Migrazione 295.';
