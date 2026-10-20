-- ROLLBACK 323 (solo con conferma di Patrizio: si perde quali turni erano straordinari).
ALTER TABLE public.shifts DROP COLUMN IF EXISTS straordinario;
