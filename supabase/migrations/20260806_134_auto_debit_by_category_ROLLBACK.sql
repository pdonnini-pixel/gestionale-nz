-- ROLLBACK 134 — ripristina il trigger MP08-only (fn_mp08_autopay della 133)
-- e rimuove il flag di categoria. Best-effort.

DROP TRIGGER IF EXISTS trg_payable_auto_debit ON public.payables;
DROP FUNCTION IF EXISTS public.fn_payable_auto_debit();

CREATE OR REPLACE FUNCTION public.fn_mp08_autopay()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_mp08 boolean := (NEW.payment_method_code = 'MP08');
BEGIN
  IF NOT v_is_mp08
     AND NEW.electronic_invoice_id IS NOT NULL
     AND COALESCE(NEW.installment_total, 1) <= 1 THEN
    SELECT (e.xml_content ~ '<ModalitaPagamento>MP08</ModalitaPagamento>')
      INTO v_is_mp08
    FROM public.electronic_invoices e WHERE e.id = NEW.electronic_invoice_id;
    v_is_mp08 := COALESCE(v_is_mp08, false);
  END IF;
  IF v_is_mp08
     AND COALESCE(NEW.is_forecast, false) = false
     AND COALESCE(NEW.gross_amount, 0) > 0
     AND COALESCE(NEW.amount_paid, 0) = 0
     AND COALESCE(NEW.status::text, 'da_pagare') NOT IN ('annullato','nota_credito','pagato','parziale','sospeso','bloccato')
  THEN
    NEW.payment_method_code := 'MP08';
    NEW.is_auto_debit       := true;
    NEW.payment_method      := 'carta_credito'::payment_method;
    NEW.due_date := (date_trunc('month', NEW.invoice_date) + interval '1 month' + interval '19 days')::date;
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_mp08_autopay ON public.payables;
CREATE TRIGGER trg_mp08_autopay
  BEFORE INSERT ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.fn_mp08_autopay();

ALTER TABLE public.cost_categories DROP COLUMN IF EXISTS auto_debit_card;
