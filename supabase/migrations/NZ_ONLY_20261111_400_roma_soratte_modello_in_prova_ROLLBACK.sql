-- ROLLBACK della NZ_ONLY 400: Roma Soratte torna alle regole di prima. Con la 401 applicata il
-- trigger delle regole riporta a 0 la pausa pagata dei turni da oggi in avanti.
BEGIN;
UPDATE public.outlet_shift_rules
   SET pausa_minuti = 30, pausa_lunga_minuti = 60, pausa_corta_pagata = NULL, giorni_pieni = NULL, updated_at = now()
 WHERE outlet_id = '8836bde0-3a78-4abe-afce-98b0c354c7c7';
COMMIT;
