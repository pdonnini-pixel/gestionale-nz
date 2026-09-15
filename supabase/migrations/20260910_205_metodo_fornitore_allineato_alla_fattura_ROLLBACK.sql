-- ROLLBACK 20260910_205 — rimette il metodo com'era prima dell'allineamento.
-- Ripristina metodo e banca dai valori salvati in suppliers_backup_metodo_20260910,
-- limitandosi ai fornitori che il giro aveva davvero cambiato. Gli altri campi non
-- vengono toccati: nel frattempo possono essere stati corretti a mano.

BEGIN;

UPDATE public.suppliers s SET
  default_payment_method  = b.default_payment_method,
  payment_method          = b.payment_method,
  payment_bank_account_id = b.payment_bank_account_id,
  updated_at = now()
FROM public.suppliers_backup_metodo_20260910 b
WHERE b.id = s.id
  AND b.default_payment_method IS DISTINCT FROM s.default_payment_method;

COMMIT;
