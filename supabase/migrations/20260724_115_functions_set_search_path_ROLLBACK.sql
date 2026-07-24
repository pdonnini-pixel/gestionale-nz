-- ROLLBACK migrazione 115 — SOLO EMERGENZA.
-- Rimuove il search_path pinnato dalle 12 funzioni (torna mutabile → REINTRODUCE
-- l'advisor 0011). Da usare solo se il pin rompesse la risoluzione di un nome.
-- ⚠️ REGOLA #0 — se applicato, applicarlo su NZ + Made + Zago.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'bank_tx_canonical_hash_occ','bank_tx_require_acube_hash','fn_parse_invoice_payments_json',
        'cash_movements_ai_upd','fn_parse_invoice_payments','auto_enable_rls_on_new_tables',
        'fn_payable_autofill_split','fn_supplier_installment_schedule','fn_supplier_config_anomaly',
        'fn_payment_anomaly_touch','fn_payment_anomaly_texts','fn_payment_proposal_touch'])
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) RESET search_path', r.proname, r.args);
  END LOOP;
END $$;
