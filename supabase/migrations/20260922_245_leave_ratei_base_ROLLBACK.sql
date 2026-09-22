-- Rollback della migrazione 245 (piano ferie, fase 1: ratei dalle paghe).
--
-- ATTENZIONE: se sono gia' stati importati dei tabulati, le righe lette
-- vengono perse. Prima di eseguirlo, salvare:
--   SELECT * FROM public.leave_accrual_imports;
--   SELECT * FROM public.leave_accrual_rows;
-- Le colonne aggiunte a employees si possono lasciare (sono additive e
-- non danno fastidio): il DROP e' commentato apposta.

BEGIN;

DROP VIEW IF EXISTS public.v_leave_balances;

-- La colonna employees.ore_settimanali_paghe_import_id punta agli import:
-- senza togliere il vincolo, la DROP TABLE qui sotto fallisce.
ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_ore_settimanali_paghe_import_id_fkey;

DROP TABLE IF EXISTS public.leave_accrual_rows;
DROP TABLE IF EXISTS public.leave_accrual_imports;
DROP FUNCTION IF EXISTS public.leave_ore_settimanali_da_rateo(numeric);

-- Colonne su employees: additive, si lasciano. Togliere il commento solo
-- con conferma esplicita, perche' e' una DROP COLUMN su tabella viva.
-- ALTER TABLE public.employees
--   DROP COLUMN IF EXISTS ore_settimanali_paghe,
--   DROP COLUMN IF EXISTS ore_settimanali_paghe_at,
--   DROP COLUMN IF EXISTS ore_settimanali_paghe_import_id;

COMMIT;
