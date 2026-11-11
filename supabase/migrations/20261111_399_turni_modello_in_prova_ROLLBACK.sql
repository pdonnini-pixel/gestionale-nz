-- ROLLBACK della 399. Toglie tre colonne: prima di eseguirlo salvare i valori
-- (SELECT outlet_id, pausa_corta_pagata, giorni_pieni FROM outlet_shift_rules;
--  SELECT id, straordinario_motivo FROM shifts WHERE straordinario_motivo IS NOT NULL;)
-- e chiedere conferma a Patrizio (regola NO DATA LOSS).
BEGIN;
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_straordinario_motivo_check;
ALTER TABLE public.shifts DROP COLUMN IF EXISTS straordinario_motivo;
ALTER TABLE public.outlet_shift_rules DROP COLUMN IF EXISTS giorni_pieni;
ALTER TABLE public.outlet_shift_rules DROP COLUMN IF EXISTS pausa_corta_pagata;
COMMIT;
