-- ROLLBACK NZ_ONLY 272 — disattiva (non cancella) le regole create dalla 272.
UPDATE public.supplier_allocation_rules
   SET is_active = false, updated_at = now()
 WHERE is_active
   AND created_by IS NULL
   AND description LIKE 'Deciso da Patrizio il 09/10/2026:%migrazione 272%';
