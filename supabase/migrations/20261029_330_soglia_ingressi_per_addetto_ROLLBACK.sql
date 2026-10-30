-- Rollback della 330: toglie le due colonne della soglia (i valori salvati si perdono:
-- fare prima un SELECT outlet_id, soglia_ingressi_feriali, soglia_ingressi_weekend di backup).
ALTER TABLE public.outlet_shift_rules
  DROP COLUMN IF EXISTS soglia_ingressi_feriali,
  DROP COLUMN IF EXISTS soglia_ingressi_weekend;
