-- ROLLBACK della 356 — Metodo scelto a mano sul fornitore
-- 1. Rimette le scadenze del caso come erano (dal backup)
UPDATE public.payables p SET
  payment_method = b.payment_method,
  is_auto_debit  = b.is_auto_debit,
  due_date       = b.due_date,
  updated_at     = now()
FROM public.payables_backup_metodo_fornitore_20261105 b
WHERE p.id = b.id;

-- 2. Toglie i trigger nuovi
DROP TRIGGER IF EXISTS trg_supplier_method_to_open_payables ON public.suppliers;
DROP TRIGGER IF EXISTS trg_supplier_mark_method_choice ON public.suppliers;
DROP FUNCTION IF EXISTS public.fn_supplier_method_to_open_payables();
DROP FUNCTION IF EXISTS public.fn_supplier_mark_method_choice();

-- 3. fn_payable_auto_debit: riapplicare la versione viva prima della 356
--    (md5 f8bbcaa66cb8ea719a0ab7a69ae29cb3, uguale su NZ e Zago), cioè quella della 210.
-- 4. La colonna suppliers.payment_method_user_at resta (additiva, nessun dato perso).
