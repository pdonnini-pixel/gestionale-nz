-- ROLLBACK 098 — ripristina la dedup 080 e rimuove le funzioni notula.
BEGIN;

DROP FUNCTION IF EXISTS public.rpc_merge_manual_notula(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.rpc_detect_notula_duplicates(uuid);

-- Ripristina fn_prevent_duplicate_payable alla versione 080 (senza ramo notula)
CREATE OR REPLACE FUNCTION public.fn_prevent_duplicate_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  existing_id uuid; existing_status text;
BEGIN
  IF NEW.is_forecast IS TRUE OR NEW.recurring_cost_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.electronic_invoice_id IS NOT NULL THEN
    SELECT id, status::text INTO existing_id, existing_status
    FROM payables
    WHERE company_id = NEW.company_id
      AND electronic_invoice_id = NEW.electronic_invoice_id
      AND COALESCE(installment_number,1) = COALESCE(NEW.installment_number,1)
    ORDER BY (status='annullato')::int ASC,
             (COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale'))::int DESC,
             created_at ASC
    LIMIT 1;
  ELSIF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN
    SELECT id, status::text INTO existing_id, existing_status
    FROM payables
    WHERE company_id = NEW.company_id
      AND electronic_invoice_id IS NULL
      AND invoice_number = NEW.invoice_number
      AND COALESCE(installment_number,1) = COALESCE(NEW.installment_number,1)
      AND (
        (supplier_id IS NOT NULL AND supplier_id = NEW.supplier_id)
        OR (supplier_vat IS NOT NULL AND supplier_vat <> '' AND supplier_vat = NEW.supplier_vat)
        OR (supplier_name IS NOT NULL AND supplier_name <> '' AND supplier_name = NEW.supplier_name)
      )
    ORDER BY (status='annullato')::int ASC,
             (COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale'))::int DESC,
             created_at ASC
    LIMIT 1;
  ELSE
    RETURN NEW;
  END IF;

  IF existing_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF existing_status IS DISTINCT FROM 'annullato' THEN
    UPDATE payables SET
      supplier_id          = COALESCE(NEW.supplier_id, supplier_id),
      supplier_name        = COALESCE(NEW.supplier_name, supplier_name),
      supplier_vat         = COALESCE(NEW.supplier_vat, supplier_vat),
      gross_amount         = COALESCE(NEW.gross_amount, gross_amount),
      net_amount           = COALESCE(NEW.net_amount, net_amount),
      vat_amount           = COALESCE(NEW.vat_amount, vat_amount),
      due_date             = COALESCE(NEW.due_date, due_date),
      original_due_date    = COALESCE(original_due_date, NEW.original_due_date, NEW.due_date),
      payment_method       = COALESCE(NEW.payment_method, payment_method),
      payment_method_code  = COALESCE(NEW.payment_method_code, payment_method_code),
      payment_method_label = COALESCE(NEW.payment_method_label, payment_method_label),
      iban                 = COALESCE(NEW.iban, iban),
      installment_total    = COALESCE(NEW.installment_total, installment_total),
      electronic_invoice_id= COALESCE(electronic_invoice_id, NEW.electronic_invoice_id),
      acube_uuid           = COALESCE(acube_uuid, NEW.acube_uuid),
      cost_category_id     = COALESCE(cost_category_id, NEW.cost_category_id),
      updated_at           = NOW()
    WHERE id = existing_id;
  END IF;
  RETURN NULL;
END;
$function$;

DROP FUNCTION IF EXISTS public.fn_normalize_invoice_number(text);

COMMIT;
