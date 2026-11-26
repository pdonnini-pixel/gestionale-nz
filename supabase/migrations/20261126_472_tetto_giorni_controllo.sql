-- 472 · tetto_giorni solo con giorni 1-7 e mai vuoto (revisore database, 26/11/2026). NO DATA LOSS:
-- solo un CHECK; prima della 472 la colonna era nuova e la UI scriveva solo giorni 1-7.
ALTER TABLE public.outlet_shift_rules DROP CONSTRAINT IF EXISTS outlet_shift_rules_tetto_giorni_validi;
ALTER TABLE public.outlet_shift_rules ADD CONSTRAINT outlet_shift_rules_tetto_giorni_validi
  CHECK (tetto_giorni IS NULL OR (tetto_giorni <@ ARRAY[1,2,3,4,5,6,7]::smallint[] AND cardinality(tetto_giorni) > 0));
