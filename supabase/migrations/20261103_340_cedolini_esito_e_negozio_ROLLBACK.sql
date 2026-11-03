-- ROLLBACK 340 — torna a come era dopo la 338.
-- Gli abbinamenti gia' liberati dal trigger non si ricreano da qui: li
-- rifa' il riscontro del mattino. Nessun dato viene cancellato: si tolgono
-- solo trigger e funzioni.
BEGIN;

DROP TRIGGER IF EXISTS trg_cash_deposit_bank_reset ON public.outlet_daily_closing_deposits;
DROP TRIGGER IF EXISTS trg_cash_deposit_first_rows ON public.outlet_daily_closing_deposits;
DROP FUNCTION IF EXISTS public.fn_cash_deposit_bank_reset();
DROP FUNCTION IF EXISTS public.fn_cash_deposit_first_rows();
DROP FUNCTION IF EXISTS public.fn_cash_deposit_free_tx(uuid, uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlet_daily_closing_deposits TO authenticated;

ALTER POLICY odcd_write ON public.outlet_daily_closing_deposits
  USING (company_id = (SELECT get_my_company_id()) AND can_write_cash_closing(outlet_id)
         AND EXISTS (SELECT 1 FROM public.outlet_daily_closings c WHERE c.id = outlet_daily_closing_deposits.closing_id AND c.status = 'bozza'))
  WITH CHECK (company_id = (SELECT get_my_company_id()) AND can_write_cash_closing(outlet_id)
         AND EXISTS (SELECT 1 FROM public.outlet_daily_closings c WHERE c.id = outlet_daily_closing_deposits.closing_id AND c.status = 'bozza'));

COMMIT;
