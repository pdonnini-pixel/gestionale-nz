-- ROLLBACK di 20260909_201_cash_must_pay.sql
--
-- ATTENZIONE: la tabella contiene le spunte fatte dall'amministrazione. Prima di
-- eseguire il DROP, salvare i dati:
--   CREATE TABLE _bkp_cash_must_pay_<data> AS SELECT * FROM public.cash_must_pay;

BEGIN;

DROP TRIGGER IF EXISTS trg_cash_must_pay_touch ON public.cash_must_pay;
DROP FUNCTION IF EXISTS public.fn_cash_must_pay_touch();
DROP TABLE IF EXISTS public.cash_must_pay;

COMMIT;
