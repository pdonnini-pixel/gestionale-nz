-- ROLLBACK 317: toglie le colonne della pausa lunga (solo con conferma di Patrizio).
ALTER TABLE public.outlet_shift_rules DROP COLUMN IF EXISTS pausa_lunga_minuti;
ALTER TABLE public.outlet_shift_rules DROP COLUMN IF EXISTS pausa_lunga_oltre_ore;
