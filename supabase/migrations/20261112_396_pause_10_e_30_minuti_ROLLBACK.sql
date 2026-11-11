-- ROLLBACK della 396: le durate di prima tornano dal backup, i default a 30 e 60.
BEGIN;
UPDATE public.outlet_shift_rules r
   SET pausa_minuti = b.pausa_minuti, pausa_lunga_minuti = b.pausa_lunga_minuti, updated_at = now()
  FROM public._bkp_20261112_outlet_shift_rules_pause b
 WHERE b.outlet_id = r.outlet_id;
ALTER TABLE public.outlet_shift_rules ALTER COLUMN pausa_minuti SET DEFAULT 30;
ALTER TABLE public.outlet_shift_rules ALTER COLUMN pausa_lunga_minuti SET DEFAULT 60;
COMMIT;
