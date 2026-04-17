-- ============================================================
-- Fase 1.3 — Aggiunge company_id a document_versions,
-- employee_outlet_allocations, user_outlet_access
-- + policy RLS proper + rimuove policy open legacy
-- Applicata su Supabase: 2026-04-17
-- ============================================================

-- 1. document_versions (0 righe)
ALTER TABLE public.document_versions
  ADD COLUMN company_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
  REFERENCES companies(id);
CREATE INDEX idx_document_versions_company ON public.document_versions(company_id);
DROP POLICY "doc_versions_all" ON public.document_versions;
CREATE POLICY "document_versions_select" ON public.document_versions
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "document_versions_write" ON public.document_versions
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 2. employee_outlet_allocations (0 righe)
ALTER TABLE public.employee_outlet_allocations
  ADD COLUMN company_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
  REFERENCES companies(id);
CREATE INDEX idx_employee_outlet_allocations_company ON public.employee_outlet_allocations(company_id);
DROP POLICY "auth_delete_employee_outlet_allocations" ON public.employee_outlet_allocations;
DROP POLICY "auth_insert_employee_outlet_allocations" ON public.employee_outlet_allocations;
DROP POLICY "auth_select_employee_outlet_allocations" ON public.employee_outlet_allocations;
DROP POLICY "auth_update_employee_outlet_allocations" ON public.employee_outlet_allocations;
CREATE POLICY "employee_outlet_allocations_select" ON public.employee_outlet_allocations
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "employee_outlet_allocations_write" ON public.employee_outlet_allocations
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 3. user_outlet_access (6 righe, backfill da outlets)
ALTER TABLE public.user_outlet_access
  ADD COLUMN company_id uuid REFERENCES companies(id);
UPDATE public.user_outlet_access uoa
SET company_id = o.company_id
FROM outlets o WHERE o.id = uoa.outlet_id;
ALTER TABLE public.user_outlet_access ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.user_outlet_access ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
CREATE INDEX idx_user_outlet_access_company ON public.user_outlet_access(company_id);
ALTER TABLE public.user_outlet_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_outlet_access_select" ON public.user_outlet_access
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "user_outlet_access_write" ON public.user_outlet_access
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- ============================================================
-- RISULTATO FINALE: Tutte le tabelle public hanno:
-- 1. company_id (uuid, NOT NULL, FK → companies)
-- 2. RLS policy _select con get_my_company_id()
-- 3. RLS policy _write con company_id + role check
-- 4. ZERO policy open (qual: true) rimaste
-- ============================================================
