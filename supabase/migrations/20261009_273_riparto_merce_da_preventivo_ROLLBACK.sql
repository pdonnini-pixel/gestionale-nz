-- ROLLBACK 273 — disattiva (non cancella) le regole merce create dalla 273.
UPDATE public.supplier_allocation_rules
   SET is_active = false, updated_at = now()
 WHERE is_active
   AND created_by IS NULL
   AND description LIKE 'Automatica: merce ripartita come il preventivo acquisti%migrazione 273%';
