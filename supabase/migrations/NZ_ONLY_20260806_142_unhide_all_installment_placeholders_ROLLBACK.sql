-- ROLLBACK NZ_ONLY 142 — ripristina lo stato precedente dal backup completo:
-- ri-marca is_placeholder=true tutte le rate che erano nel backup del 06/08/2026.
UPDATE public.payables p
SET is_placeholder = true, updated_at = now()
FROM public.payables_installment_placeholder_backup_20260806 b
WHERE p.id = b.id;
