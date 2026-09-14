-- Rollback di NZ_ONLY_20260914_220_outlet_roma_soratte.sql
-- Toglie SOLO le righe create dalla 220, individuate dal codice outlet RSO e
-- dal centro di costo roma_soratte. Non tocca il fornitore Westi (la P.IVA e
-- il profilo di pagamento sono dati veri) e non tocca la caparra già pagata
-- (le viene solo sganciato l'outlet). Da usare solo prima che l'outlet
-- accumuli dati (chiusure di cassa, fatture agganciate): se ne ha, preferire
-- is_active = false sull'outlet.

BEGIN;

DO $$
DECLARE v_company uuid; v_outlet uuid;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE vat_number = '07362100484' LIMIT 1;
  SELECT id INTO v_outlet FROM public.outlets WHERE company_id = v_company AND code = 'RSO' LIMIT 1;
  IF v_outlet IS NULL THEN RAISE NOTICE 'Outlet RSO assente: niente da annullare'; RETURN; END IF;

  DELETE FROM public.user_outlet_access WHERE outlet_id = v_outlet;
  DELETE FROM public.fiscal_deadlines WHERE company_id = v_company AND title LIKE 'Imposta di registro contratto B46%' AND status = 'pending';
  DELETE FROM public.payables WHERE company_id = v_company AND outlet_id = v_outlet AND is_forecast = true;
  UPDATE public.payables SET outlet_id = NULL WHERE company_id = v_company AND outlet_id = v_outlet;
  DELETE FROM public.outlet_payment_channels WHERE outlet_id = v_outlet;
  DELETE FROM public.outlet_attachments WHERE outlet_id = v_outlet AND is_uploaded = false;
  DELETE FROM public.supplier_allocation_details WHERE outlet_id = v_outlet;
  DELETE FROM public.supplier_allocation_rules r WHERE company_id = v_company
    AND NOT EXISTS (SELECT 1 FROM public.supplier_allocation_details d WHERE d.rule_id = r.id);
  DELETE FROM public.outlet_suppliers WHERE outlet_id = v_outlet;
  DELETE FROM public.outlet_cost_template WHERE outlet_id = v_outlet;
  DELETE FROM public.recurring_costs WHERE company_id = v_company AND cost_center = 'roma_soratte';
  DELETE FROM public.contract_deadlines WHERE contract_id IN (SELECT id FROM public.contracts WHERE outlet_id = v_outlet);
  DELETE FROM public.contract_amount_history WHERE contract_id IN (SELECT id FROM public.contracts WHERE outlet_id = v_outlet);
  DELETE FROM public.contracts WHERE outlet_id = v_outlet;
  DELETE FROM public.chart_of_accounts WHERE company_id = v_company AND outlet_link = 'roma_soratte'
    AND NOT EXISTS (SELECT 1 FROM public.budget_entries b WHERE b.company_id = v_company AND b.account_code = chart_of_accounts.code);
  DELETE FROM public.cost_centers WHERE company_id = v_company AND code = 'roma_soratte'
    AND NOT EXISTS (SELECT 1 FROM public.budget_entries b WHERE b.company_id = v_company AND b.cost_center = 'roma_soratte');
  UPDATE public.suppliers SET cost_center = 'all' WHERE company_id = v_company AND cost_center = 'roma_soratte';
  DELETE FROM public.outlets WHERE id = v_outlet
    AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closings c WHERE c.outlet_id = v_outlet);
END $$;

COMMIT;
