-- ROLLBACK 391 — rimette l'obbligo dell'IBAN solo se nessuna distinta di
-- rimborso è stata salvata senza: altrimenti non fa niente (no data loss).
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.payable_reimbursements WHERE beneficiary_iban IS NULL) THEN
    ALTER TABLE public.payable_reimbursements ALTER COLUMN beneficiary_iban SET NOT NULL;
  END IF;
END;
$do$;
