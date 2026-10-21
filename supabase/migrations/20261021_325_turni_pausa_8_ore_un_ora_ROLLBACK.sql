-- ROLLBACK 325: torna ai 30 minuti anche a 8 ore (migration 318).
ALTER TABLE public.outlet_shift_rules ALTER COLUMN pausa_lunga_minuti SET DEFAULT 30;
