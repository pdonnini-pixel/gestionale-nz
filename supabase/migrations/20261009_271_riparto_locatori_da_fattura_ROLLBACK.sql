-- ROLLBACK migrazione 271 — disattiva (non cancella) le regole create in automatico.
-- NO DATA LOSS: si usa il flag is_active, come fa la scheda Fornitori quando
-- sostituisce una regola. Le righe restano per traccia.
UPDATE public.supplier_allocation_rules
   SET is_active = false, updated_at = now()
 WHERE is_active
   AND created_by IS NULL
   AND description LIKE 'Automatica:%migrazione 271%';
