-- =====================================================================
-- Migrazione 115 — Pin di search_path sulle funzioni segnalate (advisor 0011)
-- =====================================================================
-- CHIUDE l'advisor 0011_function_search_path_mutable sulle 12 funzioni public
-- che non hanno search_path fissato. Con search_path mutabile un ruolo potrebbe
-- (in teoria) dirottare la risoluzione di nomi non qualificati.
--
-- FIX: si pinna  search_path = public, pg_temp  (stessa convenzione già usata
-- dalle funzioni di riconciliazione del repo, es. try_match_bank_transaction).
-- pg_trgm/http sono installate in public (vedi advisor 0014), quindi con `public`
-- in path similarity()/http restano risolvibili: NESSUN cambio di comportamento.
-- ALTER FUNCTION ... SET è additivo e reversibile (non tocca il corpo).
--
-- Risoluzione dinamica della firma (gestisce overload e assenza di argomenti):
-- si itera pg_proc per nome ed effettivo namespace public.
--
-- ⚠️ REGOLA #0 — applicare a mano su NZ + Made + Zago (3 project_id).
-- =====================================================================

DO $$
DECLARE
  r   RECORD;
  cnt INTEGER := 0;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'bank_tx_canonical_hash_occ',
        'bank_tx_require_acube_hash',
        'fn_parse_invoice_payments_json',
        'cash_movements_ai_upd',
        'fn_parse_invoice_payments',
        'auto_enable_rls_on_new_tables',
        'fn_payable_autofill_split',
        'fn_supplier_installment_schedule',
        'fn_supplier_config_anomaly',
        'fn_payment_anomaly_touch',
        'fn_payment_anomaly_texts',
        'fn_payment_proposal_touch'
      ])
      -- solo se non hanno già un search_path in proconfig (idempotente)
      AND NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c
        WHERE c LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp',
                   r.proname, r.args);
    cnt := cnt + 1;
    RAISE NOTICE 'search_path pinnato: public.%(%)', r.proname, r.args;
  END LOOP;
  RAISE NOTICE 'Totale funzioni con search_path pinnato: %', cnt;
END $$;

-- Verifica (deve restituire 0 righe: nessuna delle 12 senza search_path):
--   SELECT p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname = ANY (ARRAY['bank_tx_canonical_hash_occ','bank_tx_require_acube_hash',
--       'fn_parse_invoice_payments_json','cash_movements_ai_upd','fn_parse_invoice_payments',
--       'auto_enable_rls_on_new_tables','fn_payable_autofill_split','fn_supplier_installment_schedule',
--       'fn_supplier_config_anomaly','fn_payment_anomaly_touch','fn_payment_anomaly_texts',
--       'fn_payment_proposal_touch'])
--     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig,ARRAY[]::text[])) c WHERE c LIKE 'search_path=%');
