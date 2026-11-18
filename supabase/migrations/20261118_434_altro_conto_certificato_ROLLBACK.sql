-- ROLLBACK 434 — NZ + Zago. Toglie il controllo «statement_id IS NULL» dal candidato sull'altro conto.
-- Non tocca righe già inserite né domande archiviate.
DO $$
DECLARE
  d text := pg_get_functiondef('public.apply_bank_statement(uuid, jsonb, numeric, numeric, integer)'::regprocedure);
  a1 text := E'\n        -- 434: gia'' certificato dall''estratto del suo conto = movimento di quel conto, non questo.\n        AND b.statement_id IS NULL;';
BEGIN
  IF position(a1 in d) = 0 THEN RAISE EXCEPTION 'rollback 434: pezzo non trovato'; END IF;
  d := replace(d, a1, ';');
  EXECUTE d;
END $$;
