-- 061 — Redesign pagina "Personale": colonne additive + audit import.
-- Applicata identica ai 3 tenant (NZ / Made / Zago) via MCP Supabase il 2026-06-10.
-- NO DATA LOSS: solo ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS.

-- Mappatura outlet -> cost_center senza hardcoded nel frontend.
ALTER TABLE public.outlets ADD COLUMN IF NOT EXISTS cost_center_key text;

-- Netto mensile (cassa) accanto ai componenti di costo (competenza).
ALTER TABLE public.employee_costs ADD COLUMN IF NOT EXISTS netto numeric;

-- Target UPSERT per l'import mensile (employee_id, year, month).
CREATE UNIQUE INDEX IF NOT EXISTS employee_costs_employee_id_year_month_key
  ON public.employee_costs (employee_id, year, month);

-- Audit log degli import mensili ricorrenti.
CREATE TABLE IF NOT EXISTS public.employee_cost_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL,
  file_name text,
  rows_total integer DEFAULT 0,
  rows_new_employees integer DEFAULT 0,
  total_netto numeric DEFAULT 0,
  file_total numeric,
  scostamento numeric,
  imported_by uuid,
  imported_at timestamptz DEFAULT now(),
  note text
);
ALTER TABLE public.employee_cost_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_cost_imports_select ON public.employee_cost_imports;
CREATE POLICY employee_cost_imports_select ON public.employee_cost_imports
  FOR SELECT USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS employee_cost_imports_write ON public.employee_cost_imports;
CREATE POLICY employee_cost_imports_write ON public.employee_cost_imports
  FOR ALL
  USING (company_id = get_my_company_id() AND get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]));
