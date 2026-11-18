-- ROLLBACK 436 — NZ + Zago. Toglie il controllo sulla data contabile successiva. Nessun dato toccato.
DO $$
DECLARE
  d text := pg_get_functiondef('public.apply_bank_statement(uuid, jsonb, numeric, numeric, integer)'::regprocedure);
  a1 text := E'\n      -- 436: contabilizzato dopo questo estratto e confermato dal suo: sta nell''estratto successivo.\n      AND NOT (b.statement_id IS NOT NULL AND b.statement_id <> st.id AND b.booking_date > v_to)';
BEGIN
  IF position(a1 in d) = 0 THEN RAISE NOTICE 'rollback 436: gia'' tolta'; RETURN; END IF;
  d := replace(d, a1, '');
  EXECUTE d;
END $$;
