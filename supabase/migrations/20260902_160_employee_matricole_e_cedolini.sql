-- 160 — Due fatti che il modello non sapeva rappresentare:
--   1. una persona può avere più matricole (trasformazione del contratto)
--   2. un mese può avere più cedolini (13ª, 14ª, mensilità aggiuntive)
-- Applicata sui 3 tenant il 02/09/2026.
-- Vedi anche 161 (trigger che ricalcola il totale del mese dai cedolini).

CREATE TABLE IF NOT EXISTS public.employee_matricole (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  matricola   text NOT NULL,
  is_current  boolean NOT NULL DEFAULT false,
  valid_from  date, valid_to date, note text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_matricole_company_matricola_uniq
  ON public.employee_matricole (company_id, btrim(matricola));
CREATE INDEX IF NOT EXISTS employee_matricole_employee_idx ON public.employee_matricole (employee_id);
ALTER TABLE public.employee_matricole ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_matricole_select ON public.employee_matricole;
CREATE POLICY employee_matricole_select ON public.employee_matricole
  FOR SELECT USING (company_id = get_my_company_id());
DROP POLICY IF EXISTS employee_matricole_write ON public.employee_matricole;
CREATE POLICY employee_matricole_write ON public.employee_matricole
  FOR ALL USING (company_id = get_my_company_id()
             AND get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]));
REVOKE ALL ON public.employee_matricole FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_matricole TO authenticated, service_role;
INSERT INTO public.employee_matricole (company_id, employee_id, matricola, is_current)
SELECT e.company_id, e.id, btrim(e.matricola), true FROM public.employees e
WHERE e.matricola IS NOT NULL AND btrim(e.matricola) <> '' ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.employee_cost_slips (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  employee_id   uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  year          int NOT NULL,
  month         int NOT NULL CHECK (month BETWEEN 1 AND 12),
  -- normale | tredicesima | quattordicesima | aggiuntivo | manuale
  tipo          text NOT NULL DEFAULT 'normale',
  netto         numeric,
  retribuzione  numeric, contributi numeric, inail numeric, tfr numeric, altri_costi numeric,
  outlet_code   text, outlet_source text, matricola text, file_name text, source text,
  import_id     uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_cost_slips_uniq
  ON public.employee_cost_slips (company_id, employee_id, year, month, tipo);
CREATE INDEX IF NOT EXISTS employee_cost_slips_period_idx
  ON public.employee_cost_slips (company_id, year, month);
ALTER TABLE public.employee_cost_slips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_cost_slips_select ON public.employee_cost_slips;
CREATE POLICY employee_cost_slips_select ON public.employee_cost_slips
  FOR SELECT USING (company_id = get_my_company_id());
DROP POLICY IF EXISTS employee_cost_slips_write ON public.employee_cost_slips;
CREATE POLICY employee_cost_slips_write ON public.employee_cost_slips
  FOR ALL USING (company_id = get_my_company_id()
             AND get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]));
REVOKE ALL ON public.employee_cost_slips FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_cost_slips TO authenticated, service_role;

-- Backfill PRIMA del trigger: ogni riga mensile diventa un cedolino «normale».
INSERT INTO public.employee_cost_slips
  (company_id, employee_id, year, month, tipo, netto, retribuzione, contributi, inail, tfr,
   altri_costi, outlet_code, outlet_source, source, import_id, created_at)
SELECT c.company_id, c.employee_id, c.year, c.month, 'normale', c.netto, c.retribuzione,
       c.contributi, c.inail, c.tfr, c.altri_costi, c.outlet_code, c.outlet_source,
       c.source, c.import_id, COALESCE(c.created_at, now())
FROM public.employee_costs c WHERE c.employee_id IS NOT NULL ON CONFLICT DO NOTHING;
