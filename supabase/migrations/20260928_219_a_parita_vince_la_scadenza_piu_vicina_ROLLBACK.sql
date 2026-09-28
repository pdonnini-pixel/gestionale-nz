-- ROLLBACK 20260928_219
-- Rimette il tie-break ristretto alle sole rate della stessa fattura.

BEGIN;

DO $rb$
DECLARE
  v_src text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'try_match_bank_transaction';

  v_new := regexp_replace(
    v_src,
    '-- 219: a parita.*?IF COALESCE\(v_pay\.supplier_vat, v_pay\.supplier_id::text, v_pay\.supplier_name\) IS NOT DISTINCT FROM v_best_supplier_key THEN',
    'IF v_pay.invoice_number IS NOT NULL' || E'\n' ||
    '         AND v_pay.invoice_number = v_best_invoice' || E'\n' ||
    '         AND COALESCE(v_pay.supplier_vat, v_pay.supplier_id::text, v_pay.supplier_name) IS NOT DISTINCT FROM v_best_supplier_key THEN'
  );

  IF v_new = v_src THEN
    RAISE NOTICE 'ROLLBACK 219: patch non presente, niente da togliere';
    RETURN;
  END IF;

  EXECUTE v_new;
END
$rb$;

COMMIT;
