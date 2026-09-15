-- ROLLBACK NZ_ONLY 141 — ri-nasconde la rata saldo 2/2 della fattura 32 di 999 SRL
-- (ripristina lo stato precedente: rata considerata placeholder)
UPDATE public.payables
SET is_placeholder = true, updated_at = now()
WHERE supplier_id = (SELECT id FROM public.suppliers WHERE partita_iva = '04312281209' OR vat_number = '04312281209' LIMIT 1)
  AND invoice_number = '32'
  AND installment_number = 2
  AND installment_total = 2
  AND is_placeholder = false;

-- Il backup public.payables_installment_placeholder_backup_20260806 resta disponibile
-- per un ripristino completo se necessario.
