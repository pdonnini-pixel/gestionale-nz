-- =====================================================================
-- Migrazione 350 — Blocco dell'account di cassa sulle tabelle nate dopo la 172
-- =====================================================================
-- COSA MANCAVA: la 172 ha messo la policy RESTRICTIVE "cash_operator_block"
-- solo sulle tabelle che esistevano il 04/09/2026. Le tabelle create dopo
-- hanno policy di lettura del tipo `company_id = get_my_company_id()` e
-- nient'altro: un account di cassa (ruolo operatore_cassa, uno per negozio)
-- poteva leggerle via API con il proprio token. Emerso dalla revisione di
-- sicurezza della PR delle timbrature (05/11/2026).
--
-- COSA FA: aggiunge "cash_operator_block" (stessa forma della 172, con la
-- funzione d'identita' avvolta in una sottoselect come vuole la 305) alle
-- tabelle qui sotto. Solo CREATE POLICY: nessun DROP, nessun dato toccato.
-- Se la policy c'e' gia' la tabella si salta, quindi il file si puo'
-- rilanciare.
--
-- PERCHE' QUESTE E NON ALTRE (verifica del 05/11/2026 su NZ e Zago):
--   - nessuna e' letta o scritta da ChiusuraCassa.tsx, Profilo.tsx o dal
--     Layout nella versione dell'account di cassa (le uniche due rotte che il
--     ruolo puo' aprire, CASH_OPERATOR_PATHS in App.tsx);
--   - le RPC usate dalla chiusura (confirm/request_reopen/reopen/delete
--     _cash_closing, get_outlet_day_targets) e i trigger sulle tabelle della
--     chiusura sono SECURITY DEFINER di proprieta' di postgres (BYPASSRLS):
--     la RLS di queste tabelle non li tocca;
--   - le Edge Function chiamate dalla cassa (cash-closing-reopen-request,
--     closing-photo-extract) leggono con la service role.
--
-- RESTANO APERTE ALLA CASSA, di proposito: le tabelle della lista bianca
-- della 172, outlet_daily_closing_deposits, outlet_daily_closing_expenses
-- (usate da ChiusuraCassa.tsx), closing_checks e closing_check_runs (i
-- controlli delle chiusure, la cui policy di lettura gia' recinta la cassa
-- sul proprio negozio). Le tabelle di backup (_bkp_*, *_backup_*) non hanno
-- policy permissive: sono gia' invisibili all'API.
--
-- NUMERO: il file nasceva come 348; la 348 e la 349 sono della PR delle
-- timbrature (#745), quindi qui e' 350. Sui tenant (NZ, Zago) e' registrata
-- in supabase_migrations con il nome 20261105_348_cash_operator_block_tabelle_nuove.
--
-- PARITA' TENANT: dal 03/11/2026 NZ + Zago (niente Made).
-- =====================================================================

DO $$
DECLARE
  t text;
  tabelle text[] := ARRAY[
    -- incassi con carta e commissioni
    'acquirer_contracts', 'acquirer_fees', 'card_transactions',
    -- documenti della banca
    'bank_document_messages', 'bank_document_questions', 'bank_statement_lines',
    'document_corrections',
    -- fatture d'acquisto
    'invoice_cost_flags', 'invoice_cost_overrides', 'invoice_outlet_auto',
    'purchase_invoice_dispatches', 'utility_supply_points', 'outlet_travel_places',
    -- paghe
    'payroll_payment_links', 'payroll_f24_documents', 'payroll_f24_items',
    'payroll_f24_checks',
    -- personale e accessi
    'organico_hr', 'employee_app_access', 'employee_app_activation_attempts',
    'password_sync_log', 'password_sync_peers', 'password_sync_state'
  ];
BEGIN
  FOREACH t IN ARRAY tabelle LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE NOTICE 'cash_operator_block: tabella % assente, saltata', t;
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies
               WHERE schemaname = 'public' AND tablename = t
                 AND policyname = 'cash_operator_block') THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'CREATE POLICY cash_operator_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (COALESCE((SELECT public.get_my_role())::text, '''') <> ''operatore_cassa'') '
      || 'WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '''') <> ''operatore_cassa'')',
      t);
  END LOOP;
END $$;

-- Verifica (attese 23 righe, tutte RESTRICTIVE):
--   SELECT tablename, permissive FROM pg_policies
--    WHERE schemaname = 'public' AND policyname = 'cash_operator_block'
--      AND tablename IN ('acquirer_contracts','acquirer_fees','card_transactions',
--        'bank_document_messages','bank_document_questions','bank_statement_lines',
--        'document_corrections','invoice_cost_flags','invoice_cost_overrides',
--        'invoice_outlet_auto','purchase_invoice_dispatches','utility_supply_points',
--        'outlet_travel_places','payroll_payment_links','payroll_f24_documents',
--        'payroll_f24_items','payroll_f24_checks','organico_hr','employee_app_access',
--        'employee_app_activation_attempts','password_sync_log','password_sync_peers',
--        'password_sync_state');
