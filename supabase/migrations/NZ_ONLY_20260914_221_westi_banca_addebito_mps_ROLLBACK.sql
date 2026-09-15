-- Rollback di NZ_ONLY_20260914_221: toglie la banca di addebito da Westi.
BEGIN;
UPDATE public.suppliers SET payment_bank_account_id = NULL, updated_at = now() WHERE partita_iva = '06227950968';
COMMIT;
