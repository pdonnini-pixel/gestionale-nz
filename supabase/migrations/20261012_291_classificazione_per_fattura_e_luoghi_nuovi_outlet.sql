-- Migrazione 291 — classificazione per singola fattura; luoghi dei nuovi outlet (12/10/2026)
--
-- Deciso da Patrizio il 12/10/2026:
-- 1. I lavori del magazzino vanno fra gli allestimenti, il resto del magazzino
--    resta in sede. Alcuni fornitori lavorano sia al magazzino sia ai negozi
--    (Marco Ghezzi: impianto del magazzino e barriera d'aria a Barberino): la
--    categoria del fornitore non basta. Nuova tabella invoice_cost_overrides:
--    per una singola fattura fissa l'outlet (100%) e, se serve, il gruppo
--    ('allestimenti'). Vince sulla regola di riparto del fornitore.
-- 2. v_costi_outlet_da_fatture usa invoice_cost_overrides (stesse colonne).
-- 3. «Roma e ogni outlet successivo nelle stesse logiche»: merce, struttura e
--    allestimenti seguono già da soli gli outlet nuovi (quote dal preventivo e
--    dai ricavi). Mancavano i luoghi delle trasferte: ora la città di un outlet
--    attivo diventa da sola un luogo (outlet_travel_places), solo per le aziende
--    che usano già i luoghi delle trasferte.
-- Vale su ogni tenant. Solo aggiunte.

CREATE TABLE IF NOT EXISTS public.invoice_cost_overrides (
  invoice_id  uuid PRIMARY KEY REFERENCES public.electronic_invoices(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  outlet_id   uuid NOT NULL REFERENCES public.outlets(id),
  gruppo      text CHECK (gruppo IN ('allestimenti')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.invoice_cost_overrides IS
  'Classificazione di una singola fattura passiva: outlet al 100% e, se valorizzato, gruppo (allestimenti). Vince sulla regola di riparto del fornitore in v_costi_outlet_da_fatture. Migrazione 291.';
ALTER TABLE public.invoice_cost_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON public.invoice_cost_overrides FOR ALL
  USING (company_id IN (SELECT user_profiles.company_id FROM public.user_profiles WHERE user_profiles.id = auth.uid()));
CREATE POLICY viewer_no_insert ON public.invoice_cost_overrides FOR INSERT
  WITH CHECK (COALESCE((public.get_my_role())::text, '') <> 'viewer');
CREATE POLICY viewer_no_update ON public.invoice_cost_overrides FOR UPDATE
  USING (COALESCE((public.get_my_role())::text, '') <> 'viewer')
  WITH CHECK (COALESCE((public.get_my_role())::text, '') <> 'viewer');
CREATE POLICY viewer_no_delete ON public.invoice_cost_overrides FOR DELETE
  USING (COALESCE((public.get_my_role())::text, '') <> 'viewer');

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
LEFT JOIN public.outlets o ON o.id = coalesce(i.ov_outlet, q.outlet_id)
WHERE i.invoice_date IS NOT NULL
GROUP BY 1, 2, 3, 4, 5, 6, 7;

COMMENT ON VIEW public.v_costi_outlet_da_fatture IS
  'Costi da fatture passive per outlet/mese/gruppo, ripartiti con le regole dei fornitori; invoice_cost_overrides vince per la singola fattura. Sola lettura. outlet_id NULL = non assegnato. Esclusi TD16/17/18 e invoice_cost_flags. Migrazioni 285, 290, 291.';

-- 3. Città di un outlet attivo = luogo delle trasferte (solo dove i luoghi sono in uso)
CREATE OR REPLACE FUNCTION public.fn_outlet_luogo_trasferte()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF coalesce(NEW.is_active, true) AND coalesce(trim(NEW.city), '') <> ''
     AND EXISTS (SELECT 1 FROM public.outlet_travel_places t WHERE t.company_id = NEW.company_id) THEN
    INSERT INTO public.outlet_travel_places (company_id, outlet_id, kind, place, note)
    VALUES (NEW.company_id, NEW.id, 'comune', lower(trim(NEW.city)), 'automatico: città dell''outlet (migrazione 291)')
    ON CONFLICT (company_id, kind, place) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_outlet_luogo_trasferte() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_outlet_luogo_trasferte
  AFTER INSERT OR UPDATE OF city, is_active ON public.outlets
  FOR EACH ROW EXECUTE FUNCTION public.fn_outlet_luogo_trasferte();

-- Outlet già attivi la cui città non è ancora un luogo
INSERT INTO public.outlet_travel_places (company_id, outlet_id, kind, place, note)
SELECT o.company_id, o.id, 'comune', lower(trim(o.city)), 'automatico: città dell''outlet (migrazione 291)'
FROM public.outlets o
WHERE o.is_active AND coalesce(trim(o.city), '') <> ''
  AND EXISTS (SELECT 1 FROM public.outlet_travel_places t WHERE t.company_id = o.company_id)
ON CONFLICT (company_id, kind, place) DO NOTHING;
