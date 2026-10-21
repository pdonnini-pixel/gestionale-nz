-- ROLLBACK 324 (solo con conferma di Patrizio: si perde quante ore di ogni turno erano straordinario).
ALTER TABLE public.shifts DROP COLUMN IF EXISTS ore_straordinario;
