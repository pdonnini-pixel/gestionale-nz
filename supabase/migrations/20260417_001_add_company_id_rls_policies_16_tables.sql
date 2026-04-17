-- ============================================================
-- Fase 1.1 — Aggiunge policy RLS con company_id isolation
-- a 16 tabelle che attualmente hanno solo auth_* (qual: true)
-- Pattern: SELECT → get_my_company_id()
--          WRITE  → get_my_company_id() + role in (super_advisor, contabile)
-- Applicata su Supabase: 2026-04-17
-- ============================================================

-- 1. balance_sheet_data
CREATE POLICY "balance_sheet_data_select" ON public.balance_sheet_data
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "balance_sheet_data_write" ON public.balance_sheet_data
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 2. balance_sheet_imports
CREATE POLICY "balance_sheet_imports_select" ON public.balance_sheet_imports
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "balance_sheet_imports_write" ON public.balance_sheet_imports
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 3. bank_imports
CREATE POLICY "bank_imports_select" ON public.bank_imports
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "bank_imports_write" ON public.bank_imports
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 4. bank_transactions
CREATE POLICY "bank_transactions_select" ON public.bank_transactions
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "bank_transactions_write" ON public.bank_transactions
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 5. budget_confronto
CREATE POLICY "budget_confronto_select" ON public.budget_confronto
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "budget_confronto_write" ON public.budget_confronto
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 6. budget_entries
CREATE POLICY "budget_entries_select" ON public.budget_entries
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "budget_entries_write" ON public.budget_entries
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 7. cash_position
CREATE POLICY "cash_position_select" ON public.cash_position
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "cash_position_write" ON public.cash_position
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 8. chart_of_accounts
CREATE POLICY "chart_of_accounts_select" ON public.chart_of_accounts
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "chart_of_accounts_write" ON public.chart_of_accounts
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 9. company_settings
CREATE POLICY "company_settings_select" ON public.company_settings
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "company_settings_write" ON public.company_settings
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 10. cost_centers
CREATE POLICY "cost_centers_select" ON public.cost_centers
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "cost_centers_write" ON public.cost_centers
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 11. documents
CREATE POLICY "documents_select" ON public.documents
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "documents_write" ON public.documents
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 12. employee_costs
CREATE POLICY "employee_costs_select" ON public.employee_costs
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "employee_costs_write" ON public.employee_costs
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 13. employee_documents
CREATE POLICY "employee_documents_select" ON public.employee_documents
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "employee_documents_write" ON public.employee_documents
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 14. invoices
CREATE POLICY "invoices_select" ON public.invoices
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "invoices_write" ON public.invoices
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 15. payment_schedule
CREATE POLICY "payment_schedule_select" ON public.payment_schedule
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "payment_schedule_write" ON public.payment_schedule
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- 16. recurring_costs
CREATE POLICY "recurring_costs_select" ON public.recurring_costs
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "recurring_costs_write" ON public.recurring_costs
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

-- ============================================================
-- ROLLBACK (se necessario):
-- DROP POLICY "balance_sheet_data_select" ON public.balance_sheet_data;
-- DROP POLICY "balance_sheet_data_write" ON public.balance_sheet_data;
-- ... (ripetere per tutte le 16 tabelle)
-- ============================================================
