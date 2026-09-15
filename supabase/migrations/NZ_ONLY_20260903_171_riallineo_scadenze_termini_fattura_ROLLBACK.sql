-- ROLLBACK NZ_ONLY_20260903_171 — ripristina le righe dal backup integrale.
-- Non tocca righe nel frattempo pagate/agganciate a un movimento (le salta).
update public.payables p set
  due_date = b.due_date, original_due_date = b.original_due_date,
  payment_method = b.payment_method, payment_method_code = b.payment_method_code,
  payment_method_label = b.payment_method_label, notes = b.notes,
  is_auto_debit = b.is_auto_debit, status = b.status, updated_at = now()
from public._bkp_riallineo_termini_20260903 b
where b.id = p.id and coalesce(p.amount_paid,0) = 0 and p.bank_transaction_id is null;
-- Il backup NON si cancella (tabella _bkp_*): resta consultabile.
