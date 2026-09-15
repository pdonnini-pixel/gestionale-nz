-- ROLLBACK di NZ_ONLY_20260910_202_locatori_addebito_diretto.sql
-- Rimette i metodi di pagamento come stavano, leggendoli dal backup.

BEGIN;

UPDATE public.suppliers s
SET payment_method = b.metodo::payment_method, updated_at = now()
FROM _bkp_locatori_sdd_20260910 b
WHERE b.origine = 'supplier' AND b.id = s.id;

UPDATE public.payables p
SET payment_method = b.metodo::payment_method, updated_at = now()
FROM _bkp_locatori_sdd_20260910 b
WHERE b.origine = 'payable' AND b.payable_id = p.id;

COMMIT;
