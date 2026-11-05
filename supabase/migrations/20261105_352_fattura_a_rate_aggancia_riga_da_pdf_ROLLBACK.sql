-- ROLLBACK 352: ripristina fn_prevent_duplicate_payable com'era prima (definizione letta da NZ il 05/11/2026).

CREATE OR REPLACE FUNCTION public.fn_prevent_duplicate_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  existing_id uuid; existing_status text;
  v_notula_merge boolean := false; v_cands uuid[]; v_norm text;
BEGIN
  IF NEW.is_forecast IS TRUE OR NEW.recurring_cost_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.electronic_invoice_id IS NOT NULL THEN
    SELECT id, status::text INTO existing_id, existing_status FROM payables
    WHERE company_id = NEW.company_id AND electronic_invoice_id = NEW.electronic_invoice_id
      AND COALESCE(installment_number,1) = COALESCE(NEW.installment_number,1)
    ORDER BY (status='annullato')::int ASC,
             (COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale'))::int DESC,
             created_at ASC LIMIT 1;
    IF existing_id IS NULL AND COALESCE(NEW.installment_number,1)=1 AND COALESCE(NEW.installment_total,1)=1 THEN
      v_norm := public.fn_normalize_invoice_number(NEW.invoice_number);
      IF v_norm <> '' THEN
        SELECT array_agg(id) INTO v_cands FROM payables
        WHERE company_id = NEW.company_id AND electronic_invoice_id IS NULL AND acube_uuid IS NULL
          AND status IS DISTINCT FROM 'annullato' AND COALESCE(installment_number,1)=1
          AND public.fn_normalize_invoice_number(invoice_number) = v_norm
          AND ((NEW.supplier_vat IS NOT NULL AND NEW.supplier_vat<>'' AND supplier_vat=NEW.supplier_vat)
               OR (NEW.supplier_id IS NOT NULL AND supplier_id=NEW.supplier_id)
               OR (NEW.supplier_name IS NOT NULL AND supplier_name=NEW.supplier_name));
        IF v_cands IS NOT NULL AND array_length(v_cands,1)=1 THEN existing_id:=v_cands[1]; v_notula_merge:=true; END IF;
      END IF;
      IF existing_id IS NULL AND NEW.gross_amount IS NOT NULL AND NEW.gross_amount<>0 THEN
        SELECT array_agg(id) INTO v_cands FROM payables
        WHERE company_id = NEW.company_id AND electronic_invoice_id IS NULL AND acube_uuid IS NULL
          AND status IS DISTINCT FROM 'annullato' AND COALESCE(installment_number,1)=1
          AND ( abs(coalesce(gross_amount,0) - NEW.gross_amount) < 0.01
                OR (COALESCE(NEW.withholding_amount,0) > 0
                    AND abs(coalesce(gross_amount,0) - (NEW.gross_amount + NEW.withholding_amount)) < 0.01) )
          AND NEW.invoice_date IS NOT NULL AND invoice_date IS NOT NULL
          AND invoice_date BETWEEN (NEW.invoice_date - 200) AND (NEW.invoice_date + 45)
          AND ((NEW.supplier_vat IS NOT NULL AND NEW.supplier_vat<>'' AND supplier_vat=NEW.supplier_vat)
               OR (NEW.supplier_id IS NOT NULL AND supplier_id=NEW.supplier_id)
               OR (NEW.supplier_name IS NOT NULL AND supplier_name=NEW.supplier_name));
        IF v_cands IS NOT NULL AND array_length(v_cands,1)=1 THEN
          existing_id:=v_cands[1]; v_notula_merge:=true;
          SELECT status::text INTO existing_status FROM payables WHERE id=existing_id;
        END IF;
      END IF;
    END IF;
  ELSIF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN
    SELECT id, status::text INTO existing_id, existing_status FROM payables
    WHERE company_id = NEW.company_id AND electronic_invoice_id IS NULL
      AND invoice_number = NEW.invoice_number
      AND COALESCE(installment_number,1) = COALESCE(NEW.installment_number,1)
      AND ((supplier_id IS NOT NULL AND supplier_id=NEW.supplier_id)
           OR (supplier_vat IS NOT NULL AND supplier_vat<>'' AND supplier_vat=NEW.supplier_vat)
           OR (supplier_name IS NOT NULL AND supplier_name<>'' AND supplier_name=NEW.supplier_name))
    ORDER BY (status='annullato')::int ASC,
             (COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale'))::int DESC,
             created_at ASC LIMIT 1;
  ELSE RETURN NEW; END IF;
  IF existing_id IS NULL THEN RETURN NEW; END IF;
  IF v_notula_merge THEN
    UPDATE payables SET
      invoice_number=NEW.invoice_number, invoice_date=NEW.invoice_date,
      electronic_invoice_id=NEW.electronic_invoice_id, acube_uuid=COALESCE(acube_uuid,NEW.acube_uuid),
      net_amount=COALESCE(NEW.net_amount,net_amount), vat_amount=COALESCE(NEW.vat_amount,vat_amount),
      gross_amount=COALESCE(NEW.gross_amount,gross_amount),
      withholding_amount=COALESCE(NEW.withholding_amount,withholding_amount),
      due_date=CASE WHEN status IN ('pagato','parziale') THEN due_date ELSE COALESCE(NEW.due_date,due_date) END,
      original_due_date=COALESCE(original_due_date,NEW.original_due_date,NEW.due_date),
      payment_method=COALESCE(payment_method,NEW.payment_method),
      payment_method_code=COALESCE(payment_method_code,NEW.payment_method_code),
      supplier_id=COALESCE(supplier_id,NEW.supplier_id), supplier_name=COALESCE(NEW.supplier_name,supplier_name),
      supplier_vat=COALESCE(NEW.supplier_vat,supplier_vat), cost_category_id=COALESCE(cost_category_id,NEW.cost_category_id),
      notes=COALESCE(NULLIF(notes,''),'')||CASE WHEN COALESCE(notes,'')<>'' THEN ' ' ELSE '' END||'[Notula agganciata alla fattura SDI '||COALESCE(NEW.invoice_number,'')||']',
      updated_at=NOW()
    WHERE id=existing_id;
    RETURN NULL;
  END IF;
  IF existing_status IS DISTINCT FROM 'annullato' THEN
    UPDATE payables SET
      supplier_id=COALESCE(NEW.supplier_id,supplier_id), supplier_name=COALESCE(NEW.supplier_name,supplier_name),
      supplier_vat=COALESCE(NEW.supplier_vat,supplier_vat), gross_amount=COALESCE(NEW.gross_amount,gross_amount),
      withholding_amount=COALESCE(NEW.withholding_amount,withholding_amount),
      net_amount=COALESCE(NEW.net_amount,net_amount), vat_amount=COALESCE(NEW.vat_amount,vat_amount),
      due_date=COALESCE(NEW.due_date,due_date), original_due_date=COALESCE(original_due_date,NEW.original_due_date,NEW.due_date),
      payment_method=COALESCE(NEW.payment_method,payment_method), payment_method_code=COALESCE(NEW.payment_method_code,payment_method_code),
      payment_method_label=COALESCE(NEW.payment_method_label,payment_method_label), iban=COALESCE(NEW.iban,iban),
      installment_total=COALESCE(NEW.installment_total,installment_total),
      electronic_invoice_id=COALESCE(electronic_invoice_id,NEW.electronic_invoice_id), acube_uuid=COALESCE(acube_uuid,NEW.acube_uuid),
      cost_category_id=COALESCE(cost_category_id,NEW.cost_category_id), updated_at=NOW()
    WHERE id=existing_id;
  END IF;
  RETURN NULL;
END; $function$;
