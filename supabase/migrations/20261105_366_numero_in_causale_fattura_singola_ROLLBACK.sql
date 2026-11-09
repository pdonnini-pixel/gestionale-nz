-- ROLLBACK della migrazione 366: toglie dalle tre funzioni le righe marcate «366» e
-- lascia causale_cita_fattura e causale_per_numeri (non le chiama più nessuno; per
-- toglierle: DROP FUNCTION public.causale_cita_fattura(text), public.causale_per_numeri(text);). Nessun dato toccato. NZ + Zago.

BEGIN;

DO $$
DECLARE
  r record;
  v_def text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.try_match_bank_transaction(uuid)'::regprocedure,
       E'    -- 366: se la causale cita un numero di fattura leggibile, vale solo la fattura citata.\n'
       || E'    IF public.causale_cita_fattura(v_bt.description)\n'
       || E'       AND NOT public.invoice_cited_in_text(coalesce(v_pay.invoice_number, ''''), public.causale_per_numeri(v_bt.description), 2) THEN\n'
       || E'      CONTINUE;\n'
       || E'    END IF;\n\n'),
      ('public.rerun_bijective_reconciliation()'::regprocedure,
       E'      -- 366: causale con numero di fattura leggibile: solo la fattura citata.\n'
       || E'      AND (NOT public.causale_cita_fattura(bt.description)\n'
       || E'           OR public.invoice_cited_in_text(coalesce(v_pay.invoice_number, ''''), public.causale_per_numeri(bt.description), 2))\n'),
      ('public.try_match_amount_bank_transaction(uuid)'::regprocedure,
       E'      -- 366: causale con numero di fattura leggibile: solo la fattura citata.\n'
       || E'      AND (NOT public.causale_cita_fattura(v_descr)\n'
       || E'           OR public.invoice_cited_in_text(coalesce(p.invoice_number, ''''), public.causale_per_numeri(v_descr), 2))\n')
    ) AS t(fn, ins)
  LOOP
    v_def := pg_get_functiondef(r.fn);
    CONTINUE WHEN position(r.ins IN v_def) = 0;
    EXECUTE replace(v_def, r.ins, '');
  END LOOP;
END $$;

COMMIT;
