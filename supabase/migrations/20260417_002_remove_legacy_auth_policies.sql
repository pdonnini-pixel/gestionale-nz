-- ============================================================
-- Fase 1.2 — Rimuove TUTTE le policy legacy auth_* (qual: true)
-- Aggiunge prima policy proper a 3 tabelle che ne erano sprovviste
-- Applicata su Supabase: 2026-04-17
-- ============================================================

-- STEP 1: Aggiunge policy proper a app_users, contract_documents, import_documents

CREATE POLICY "app_users_select" ON public.app_users
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "app_users_write" ON public.app_users
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

CREATE POLICY "contract_documents_select" ON public.contract_documents
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "contract_documents_write" ON public.contract_documents
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));

CREATE POLICY "import_documents_select" ON public.import_documents
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "import_documents_write" ON public.import_documents
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['super_advisor'::user_role, 'contabile'::user_role]));


-- STEP 2: Rimuove TUTTE le policy legacy auth_* e altre open (qual: true)
-- 22 tabelle coinvolte, ~100 policy rimosse

-- balance_sheet_data
DROP POLICY "auth_delete_balance_sheet_data" ON public.balance_sheet_data;
DROP POLICY "auth_insert_balance_sheet_data" ON public.balance_sheet_data;
DROP POLICY "auth_select_balance_sheet_data" ON public.balance_sheet_data;
DROP POLICY "auth_update_balance_sheet_data" ON public.balance_sheet_data;

-- balance_sheet_imports
DROP POLICY "auth_delete_balance_sheet_imports" ON public.balance_sheet_imports;
DROP POLICY "auth_insert_balance_sheet_imports" ON public.balance_sheet_imports;
DROP POLICY "auth_select_balance_sheet_imports" ON public.balance_sheet_imports;
DROP POLICY "auth_update_balance_sheet_imports" ON public.balance_sheet_imports;

-- bank_accounts
DROP POLICY "auth_delete_bank_accounts" ON public.bank_accounts;
DROP POLICY "auth_insert_bank_accounts" ON public.bank_accounts;
DROP POLICY "auth_select_bank_accounts" ON public.bank_accounts;
DROP POLICY "auth_update_bank_accounts" ON public.bank_accounts;

-- bank_imports
DROP POLICY "auth_delete_bank_imports" ON public.bank_imports;
DROP POLICY "auth_insert_bank_imports" ON public.bank_imports;
DROP POLICY "auth_select_bank_imports" ON public.bank_imports;
DROP POLICY "auth_update_bank_imports" ON public.bank_imports;

-- bank_transactions
DROP POLICY "auth_delete_bank_transactions" ON public.bank_transactions;
DROP POLICY "auth_insert_bank_transactions" ON public.bank_transactions;
DROP POLICY "auth_select_bank_transactions" ON public.bank_transactions;
DROP POLICY "auth_update_bank_transactions" ON public.bank_transactions;

-- budget_confronto
DROP POLICY "auth_delete_budget_confronto" ON public.budget_confronto;
DROP POLICY "auth_insert_budget_confronto" ON public.budget_confronto;
DROP POLICY "auth_select_budget_confronto" ON public.budget_confronto;
DROP POLICY "auth_update_budget_confronto" ON public.budget_confronto;

-- budget_entries
DROP POLICY "auth_delete_budget_entries" ON public.budget_entries;
DROP POLICY "auth_insert_budget_entries" ON public.budget_entries;
DROP POLICY "auth_select_budget_entries" ON public.budget_entries;
DROP POLICY "auth_update_budget_entries" ON public.budget_entries;

-- cash_position
DROP POLICY "auth_delete_cash_position" ON public.cash_position;
DROP POLICY "auth_insert_cash_position" ON public.cash_position;
DROP POLICY "auth_select_cash_position" ON public.cash_position;
DROP POLICY "auth_update_cash_position" ON public.cash_position;

-- chart_of_accounts
DROP POLICY "auth_delete_chart_of_accounts" ON public.chart_of_accounts;
DROP POLICY "auth_insert_chart_of_accounts" ON public.chart_of_accounts;
DROP POLICY "auth_select_chart_of_accounts" ON public.chart_of_accounts;
DROP POLICY "auth_update_chart_of_accounts" ON public.chart_of_accounts;

-- company_settings
DROP POLICY "auth_delete_company_settings" ON public.company_settings;
DROP POLICY "auth_insert_company_settings" ON public.company_settings;
DROP POLICY "auth_select_company_settings" ON public.company_settings;
DROP POLICY "auth_update_company_settings" ON public.company_settings;

-- contract_documents
DROP POLICY "auth_delete_contract_documents" ON public.contract_documents;
DROP POLICY "auth_insert_contract_documents" ON public.contract_documents;
DROP POLICY "auth_select_contract_documents" ON public.contract_documents;
DROP POLICY "auth_update_contract_documents" ON public.contract_documents;
DROP POLICY "Authenticated users can delete contract_documents" ON public.contract_documents;
DROP POLICY "Authenticated users can insert contract_documents" ON public.contract_documents;
DROP POLICY "Authenticated users can read contract_documents" ON public.contract_documents;

-- cost_centers
DROP POLICY "auth_delete_cost_centers" ON public.cost_centers;
DROP POLICY "auth_insert_cost_centers" ON public.cost_centers;
DROP POLICY "auth_select_cost_centers" ON public.cost_centers;
DROP POLICY "auth_update_cost_centers" ON public.cost_centers;

-- documents
DROP POLICY "auth_delete_documents" ON public.documents;
DROP POLICY "auth_insert_documents" ON public.documents;
DROP POLICY "auth_select_documents" ON public.documents;
DROP POLICY "auth_update_documents" ON public.documents;

-- employee_costs
DROP POLICY "auth_delete_employee_costs" ON public.employee_costs;
DROP POLICY "auth_insert_employee_costs" ON public.employee_costs;
DROP POLICY "auth_select_employee_costs" ON public.employee_costs;
DROP POLICY "auth_update_employee_costs" ON public.employee_costs;

-- employee_documents
DROP POLICY "auth_delete_employee_documents" ON public.employee_documents;
DROP POLICY "auth_insert_employee_documents" ON public.employee_documents;
DROP POLICY "auth_select_employee_documents" ON public.employee_documents;
DROP POLICY "auth_update_employee_documents" ON public.employee_documents;

-- employees
DROP POLICY "auth_delete_employees" ON public.employees;
DROP POLICY "auth_insert_employees" ON public.employees;
DROP POLICY "auth_select_employees" ON public.employees;
DROP POLICY "auth_update_employees" ON public.employees;
DROP POLICY "employees_update" ON public.employees;

-- import_documents
DROP POLICY "auth_delete_import_documents" ON public.import_documents;
DROP POLICY "auth_insert_import_documents" ON public.import_documents;
DROP POLICY "auth_select_import_documents" ON public.import_documents;
DROP POLICY "auth_update_import_documents" ON public.import_documents;
DROP POLICY "Auth delete import_documents" ON public.import_documents;
DROP POLICY "Auth insert import_documents" ON public.import_documents;
DROP POLICY "Auth read import_documents" ON public.import_documents;

-- invoices
DROP POLICY "auth_delete_invoices" ON public.invoices;
DROP POLICY "auth_insert_invoices" ON public.invoices;
DROP POLICY "auth_select_invoices" ON public.invoices;
DROP POLICY "auth_update_invoices" ON public.invoices;

-- loans
DROP POLICY "auth_delete_loans" ON public.loans;
DROP POLICY "auth_insert_loans" ON public.loans;
DROP POLICY "auth_select_loans" ON public.loans;
DROP POLICY "auth_update_loans" ON public.loans;

-- outlet_attachments
DROP POLICY "outlet_att_delete" ON public.outlet_attachments;
DROP POLICY "outlet_att_update" ON public.outlet_attachments;
DROP POLICY "outlet_attachments_delete" ON public.outlet_attachments;
DROP POLICY "outlet_att_insert" ON public.outlet_attachments;
DROP POLICY "outlet_att_select" ON public.outlet_attachments;

-- outlets
DROP POLICY "outlets_delete" ON public.outlets;

-- payment_schedule
DROP POLICY "auth_delete_payment_schedule" ON public.payment_schedule;
DROP POLICY "auth_insert_payment_schedule" ON public.payment_schedule;
DROP POLICY "auth_select_payment_schedule" ON public.payment_schedule;
DROP POLICY "auth_update_payment_schedule" ON public.payment_schedule;

-- recurring_costs
DROP POLICY "recurring_costs_all" ON public.recurring_costs;

-- suppliers
DROP POLICY "auth_delete_suppliers" ON public.suppliers;
DROP POLICY "auth_insert_suppliers" ON public.suppliers;
DROP POLICY "auth_select_suppliers" ON public.suppliers;
DROP POLICY "auth_update_suppliers" ON public.suppliers;

-- app_users
DROP POLICY "auth_delete_app_users" ON public.app_users;
DROP POLICY "auth_insert_app_users" ON public.app_users;
DROP POLICY "auth_select_app_users" ON public.app_users;
DROP POLICY "auth_update_app_users" ON public.app_users;

-- ============================================================
-- Residue: document_versions e employee_outlet_allocations
-- hanno ancora policy open perché mancano di company_id.
-- Saranno corrette nella migrazione successiva (Task #25).
-- ============================================================
