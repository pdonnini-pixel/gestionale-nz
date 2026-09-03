-- ROLLBACK 20260903_170 — ritenuta d'acconto sulle scadenze.
--
-- Cosa fa:
--   1. Ripristina i payables toccati dal backfill dalla tabella di backup
--      payables_bak_ritenuta_20260903 (gross_amount, withholding_amount, amount_paid).
--   2. Toglie il trigger sulla ritenuta e riporta le 4 funzioni alla versione
--      precedente (fn_invoice_to_payable = mig 080, sync_acube_sdi_passive_to_payable
--      = mig 131, fn_payable_autofill_split = mig 053, fn_prevent_duplicate_payable = mig 098).
-- Cosa NON fa (REGOLA NO DATA LOSS): non elimina le colonne withholding_amount ne'
-- la tabella di backup. Le colonne restano a 0 e non disturbano.
--
-- ATTENZIONE: dopo il rollback le scadenze dei professionisti tornano al LORDO e
-- il motore di riconciliazione non trova piu' i bonifici al netto.

BEGIN;

-- 1. Dati: ripristino dal backup
UPDATE public.payables p
   SET gross_amount = b.gross_amount,
       withholding_amount = 0,
       amount_paid = b.amount_paid,
       updated_at = now()
  FROM public.payables_bak_ritenuta_20260903 b
 WHERE b.id = p.id;

-- 2. Trigger ritenuta
DROP TRIGGER IF EXISTS trg_electronic_invoice_withholding ON public.electronic_invoices;
DROP FUNCTION IF EXISTS public.fn_electronic_invoice_withholding();
DROP FUNCTION IF EXISTS public.fn_invoice_withholding(text, jsonb);

-- 3. fn_payable_autofill_split (versione mig 053)
CREATE OR REPLACE FUNCTION public.fn_payable_autofill_split()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $$
DECLARE
  v_ei_net   numeric;
  v_ei_vat   numeric;
  v_ei_gross numeric;
  v_net      numeric;
BEGIN
  IF (NEW.net_amount IS NULL OR NEW.net_amount = 0)
     AND NEW.gross_amount IS NOT NULL AND NEW.gross_amount <> 0
     AND NEW.electronic_invoice_id IS NOT NULL
  THEN
    SELECT net_amount, vat_amount, gross_amount
      INTO v_ei_net, v_ei_vat, v_ei_gross
      FROM public.electronic_invoices
      WHERE id = NEW.electronic_invoice_id;
    IF v_ei_gross IS NOT NULL AND v_ei_gross <> 0
       AND v_ei_net IS NOT NULL AND v_ei_net <> 0
    THEN
      v_net := round(v_ei_net * (NEW.gross_amount / v_ei_gross), 2);
      NEW.net_amount := v_net;
      NEW.vat_amount := round(NEW.gross_amount - v_net, 2);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payable_autofill_split ON public.payables;
CREATE TRIGGER trg_payable_autofill_split
  BEFORE INSERT OR UPDATE OF gross_amount, electronic_invoice_id, net_amount
  ON public.payables
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_payable_autofill_split();

-- 4. fn_invoice_to_payable (versione mig 080)
CREATE OR REPLACE FUNCTION public.fn_invoice_to_payable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
declare v_supplier_id uuid; v_due date; n int; sum_rate numeric; tol numeric; i int; v_dues date[]; v_amts numeric[]; v_mets text[];
begin
  if NEW.acube_uuid is not null then return NEW; end if;
  select id into v_supplier_id from suppliers where company_id = NEW.company_id
    and ((NEW.supplier_vat is not null and vat_number = NEW.supplier_vat) or (NEW.supplier_name is not null and name ilike NEW.supplier_name)) limit 1;
  select array_agg(due_date order by installment), array_agg(amount order by installment), array_agg(method order by installment), count(*), coalesce(sum(amount),0)
    into v_dues, v_amts, v_mets, n, sum_rate from public.fn_parse_invoice_payments(NEW.xml_content) where due_date is not null and amount is not null;
  if coalesce(NEW.gross_amount,0) <= 0 or n is null or n = 0 then
    v_due := coalesce(NEW.due_date, NEW.invoice_date);
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, net_amount, vat_amount, gross_amount, amount_remaining, electronic_invoice_id, import_batch_id, payment_method_code, installment_number, installment_total, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_due, v_due, NEW.net_amount, NEW.vat_amount, NEW.gross_amount, NEW.gross_amount, NEW.id, NEW.import_batch_id, NEW.payment_method, 1, 1, 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
    return NEW;
  end if;
  tol := greatest(0.05, NEW.gross_amount*0.001);
  if abs(sum_rate - NEW.gross_amount) > tol then
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, net_amount, vat_amount, gross_amount, amount_remaining, electronic_invoice_id, import_batch_id, payment_method_code, installment_number, installment_total, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[1], v_dues[1], NEW.net_amount, NEW.vat_amount, NEW.gross_amount, NEW.gross_amount, NEW.id, NEW.import_batch_id, coalesce(v_mets[1], NEW.payment_method), 1, 1, 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
    return NEW;
  end if;
  if n = 1 then
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, net_amount, vat_amount, gross_amount, amount_remaining, electronic_invoice_id, import_batch_id, payment_method_code, installment_number, installment_total, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[1], v_dues[1], NEW.net_amount, NEW.vat_amount, NEW.gross_amount, NEW.gross_amount, NEW.id, NEW.import_batch_id, coalesce(v_mets[1], NEW.payment_method), 1, 1, 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
    return NEW;
  end if;
  v_amts[n] := round(NEW.gross_amount - (select coalesce(sum(a),0) from unnest(v_amts[1:n-1]) a), 2);
  for i in 1..n loop
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, gross_amount, amount_remaining, electronic_invoice_id, import_batch_id, installment_number, installment_total, payment_method_code, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[i], v_dues[i], v_amts[i], v_amts[i], NEW.id, NEW.import_batch_id, i, n, coalesce(v_mets[i], NEW.payment_method), 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
  end loop;
  return NEW;
end; $function$;

-- 5. sync_acube_sdi_passive_to_payable e fn_prevent_duplicate_payable:
--    riapplicare rispettivamente
--      supabase/migrations/20260731_131_acube_bridge_skip_reverse_charge_autofattura.sql
--      supabase/migrations/20260720_098_notula_manual_acube_merge.sql
--    (definizioni integrali, invariate: non duplicate qui per non divergere).

COMMIT;
