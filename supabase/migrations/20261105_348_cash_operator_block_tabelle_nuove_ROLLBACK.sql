-- ROLLBACK della migrazione 348: toglie "cash_operator_block" dalle 23 tabelle
-- a cui la 348 l'aveva aggiunta. Solo policy, nessun dato. Riapre all'account
-- di cassa la lettura via API di queste tabelle: usarlo solo se la 348 blocca
-- qualcosa che la chiusura di cassa deve vedere.
DO $$
DECLARE
  t text;
  tabelle text[] := ARRAY[
    'acquirer_contracts', 'acquirer_fees', 'card_transactions',
    'bank_document_messages', 'bank_document_questions', 'bank_statement_lines',
    'document_corrections',
    'invoice_cost_flags', 'invoice_cost_overrides', 'invoice_outlet_auto',
    'purchase_invoice_dispatches', 'utility_supply_points', 'outlet_travel_places',
    'payroll_payment_links', 'payroll_f24_documents', 'payroll_f24_items',
    'payroll_f24_checks',
    'organico_hr', 'employee_app_access', 'employee_app_activation_attempts',
    'password_sync_log', 'password_sync_peers', 'password_sync_state'
  ];
BEGIN
  FOREACH t IN ARRAY tabelle LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS cash_operator_block ON public.%I', t);
    END IF;
  END LOOP;
END $$;
