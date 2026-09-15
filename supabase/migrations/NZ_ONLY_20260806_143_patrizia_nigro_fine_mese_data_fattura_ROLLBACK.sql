-- ROLLBACK di NZ_ONLY_20260806_143 — ripristina i valori pre-fix di PATRIZIA NIGRO.
-- Valori originali (backup catturato in sessione 2026-08-06):
--   suppliers.prima_scadenza_gg = 30 (base fine_mese, metodo riba_30)
--   payables 88-2026: due_date/original_due_date = 2026-09-30

begin;

update public.suppliers
   set prima_scadenza_gg = 30, updated_at = now()
 where partita_iva = '02063730978'
   and payment_base = 'fine_mese'
   and prima_scadenza_gg = 0;

update public.payables
   set due_date = date '2026-09-30',
       original_due_date = date '2026-09-30',
       updated_at = now()
 where supplier_vat = '02063730978'
   and invoice_number = '88-2026'
   and due_date = date '2026-08-31'
   and coalesce(amount_paid, 0) = 0;

commit;
