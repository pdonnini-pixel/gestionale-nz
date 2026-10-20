-- ROLLBACK 318: torna al default di un'ora per la pausa da 8 ore.
ALTER TABLE public.outlet_shift_rules ALTER COLUMN pausa_lunga_minuti SET DEFAULT 60;
