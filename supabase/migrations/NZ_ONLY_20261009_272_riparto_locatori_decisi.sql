-- NZ_ONLY Migrazione 272 — riparto dei locatori le cui fatture non nominano l'outlet
--
-- Deciso da Patrizio il 09/10/2026 (le fatture di questi fornitori non dicono a
-- quale punto vendita si riferiscono, quindi la 271 non poteva ricavarlo):
--   Frankie Retail Holdco S.r.l.   (P.IVA 10738940963) -> FRANCIACORTA
--   SAN MAURO SPA                  (P.IVA 01918380997) -> BRUGNATO
--   FUTURA IMMOBILIARE S.R.L.      (P.IVA 07168730484) -> SEDE / MAGAZZINO (magazzino vecchio)
--   Impresa Valdarno S.A.S.        (P.IVA 07427410480) -> SEDE / MAGAZZINO (provvigione locazione Pian di Rona)
-- Aggancio fornitore per P.IVA (PAYMENT_PLAN_NOTES.md), outlet per cost_center_key.
-- Solo INSERT; un fornitore che ha già una regola attiva non viene toccato.
-- Solo NZ: sono fornitori e decisioni di questo tenant.

DO $$
DECLARE
  r record;
  v_rule uuid;
BEGIN
  FOR r IN
    SELECT s.id AS supplier_id, s.company_id, s.name AS supplier_name, o.id AS outlet_id, o.name AS outlet_name, m.motivo
    FROM (VALUES
      ('10738940963', 'franciacorta',   'locatore di Franciacorta'),
      ('01918380997', 'brugnato',       'affitto ramo d''azienda Brugnato'),
      ('07168730484', 'sede_magazzino', 'locazione del magazzino vecchio'),
      ('07427410480', 'sede_magazzino', 'provvigione per la locazione di Pian di Rona')
    ) AS m(vat, cc_key, motivo)
    JOIN public.suppliers s ON s.vat_number = m.vat
    JOIN public.outlets o ON o.company_id = s.company_id AND o.cost_center_key = m.cc_key
    WHERE NOT EXISTS (SELECT 1 FROM public.supplier_allocation_rules ar
                       WHERE ar.supplier_id = s.id AND ar.is_active)
  LOOP
    INSERT INTO public.supplier_allocation_rules (company_id, supplier_id, allocation_mode, description, is_active)
    VALUES (r.company_id, r.supplier_id, 'DIRETTO',
            format('Deciso da Patrizio il 09/10/2026: %s, tutto a %s (migrazione 272)', r.motivo, r.outlet_name),
            true)
    RETURNING id INTO v_rule;
    INSERT INTO public.supplier_allocation_details (rule_id, outlet_id, percentage)
    VALUES (v_rule, r.outlet_id, 100);
    RAISE NOTICE 'Regola DIRETTO: % -> %', r.supplier_name, r.outlet_name;
  END LOOP;
END $$;
