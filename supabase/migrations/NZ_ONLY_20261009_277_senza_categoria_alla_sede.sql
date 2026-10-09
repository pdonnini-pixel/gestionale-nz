-- NZ_ONLY Migrazione 277 — fornitori senza categoria rimasti senza outlet: alla sede
--
-- Deciso da Patrizio il 09/10/2026: i fornitori senza categoria che non sono
-- merce (abbigliamento/accessori, migrazione 275) e le cui fatture non nominano
-- un outlet sono costi di struttura e vanno alla sede. Riguarda solo chi ha
-- fatture negli ultimi 12 mesi e nessuna regola di riparto attiva.
-- La descrizione inizia per «Automatica:»: se in futuro le sue fatture
-- nomineranno un outlet, il riparto notturno la aggiornerà da sé.

DO $$
DECLARE
  r record;
  v_rule uuid;
BEGIN
  FOR r IN
    SELECT s.id, s.company_id, hq.outlet_id
    FROM public.suppliers s
    JOIN LATERAL (
      SELECT o.id AS outlet_id FROM public.cost_centers cc
      JOIN public.outlets o ON o.company_id = cc.company_id AND o.cost_center_key = cc.code AND o.is_active
      WHERE cc.company_id = s.company_id AND cc.role = 'hq' ORDER BY o.created_at LIMIT 1
    ) hq ON true
    WHERE s.default_cost_category_id IS NULL
      AND coalesce(nullif(s.cost_center, ''), 'all') = 'all'
      AND NOT EXISTS (SELECT 1 FROM public.supplier_allocation_rules ar WHERE ar.supplier_id = s.id AND ar.is_active)
      AND EXISTS (SELECT 1 FROM public.payables p JOIN public.electronic_invoices e ON e.id = p.electronic_invoice_id
                  WHERE p.supplier_id = s.id AND e.invoice_date >= (now() AT TIME ZONE 'Europe/Rome')::date - interval '12 months')
  LOOP
    INSERT INTO public.supplier_allocation_rules (company_id, supplier_id, allocation_mode, description, is_active)
    VALUES (r.company_id, r.id, 'DIRETTO',
            'Automatica: costo di struttura senza categoria, alla sede (deciso da Patrizio il 09/10/2026, migrazione 277)',
            true)
    RETURNING id INTO v_rule;
    INSERT INTO public.supplier_allocation_details (rule_id, outlet_id, percentage)
    VALUES (v_rule, r.outlet_id, 100);
  END LOOP;
END $$;
