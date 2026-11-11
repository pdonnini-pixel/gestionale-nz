-- ROLLBACK della 401. Le funzioni tornano a leggere solo pausa_minuti, i trigger
-- spariscono. L'ultimo passo toglie la colonna shifts.pausa_pagata_minuti: e' un
-- dato calcolato (si rifa' dalle regole), ma prima di eseguirlo chiedere conferma
-- a Patrizio (regola NO DATA LOSS) e spegnere pausa_corta_pagata nei negozi che
-- l'hanno accesa, altrimenti le ore timbrate tornano a togliere i 10 minuti.
BEGIN;

DO $do$
DECLARE
  f record;
  d text;
  c_pagata constant text := $x$COALESCE((SELECT s.pausa_pagata_minuti FROM public.shifts s WHERE s.id = t.shift_id), 0)$x$;
BEGIN
  FOR f IN
    SELECT * FROM (VALUES
      ('public.app_dipendente_oggi()', $x$ 'pausa_pagata_minuti', $x$ || c_pagata || ',', ''),
      ('public.app_dipendente_periodo(date,date)', $x$ 'pausa_pagata_minuti', $x$ || c_pagata || ',', ''),
      ('public.timbratrice_dati(uuid)', $x$, 'pausa_pagata_minuti', $x$ || c_pagata || ')', ')'),
      ('public.timbrature_evento_da_timbratura(uuid,text)',
       $x$SELECT sum(t.pausa_minuti + $x$ || c_pagata || $x$) INTO v_pausa  -- 401: pausa concessa$x$,
       $x$SELECT sum(t.pausa_minuti) INTO v_pausa$x$)
    ) AS v(firma, nuovo, vecchio)
  LOOP
    d := pg_get_functiondef(f.firma::regprocedure);
    IF position('pausa_pagata_minuti' in d) = 0 THEN CONTINUE; END IF;
    IF position(f.nuovo in d) = 0 THEN RAISE EXCEPTION '401 rollback: testo non trovato in %', f.firma; END IF;
    EXECUTE replace(d, f.nuovo, f.vecchio);
  END LOOP;
END
$do$;

DROP TRIGGER IF EXISTS trg_outlet_shift_rules_pausa_pagata ON public.outlet_shift_rules;
DROP FUNCTION IF EXISTS public.outlet_shift_rules_ricalcola_pausa_pagata();
DROP TRIGGER IF EXISTS trg_shifts_pausa_pagata ON public.shifts;
DROP FUNCTION IF EXISTS public.shifts_pausa_pagata();
DROP FUNCTION IF EXISTS public.pausa_pagata_del_turno(uuid, time, time, integer);
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_pausa_pagata_minuti_check;
ALTER TABLE public.shifts DROP COLUMN IF EXISTS pausa_pagata_minuti;

COMMIT;
