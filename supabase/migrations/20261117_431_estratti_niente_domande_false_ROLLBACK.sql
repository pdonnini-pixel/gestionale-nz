-- ROLLBACK 431 — NZ + Zago. Toglie i due controlli da apply_bank_statement (stessa tecnica, al
-- contrario). La funzione fn_bank_codici_in_conflitto resta: non fa niente se nessuno la chiama.
DO $$
DECLARE
  d text := pg_get_functiondef('public.apply_bank_statement(uuid, jsonb, numeric, numeric, integer)'::regprocedure);
  a1 text := E'\n        -- 431: codici identificativi diversi = movimento diverso, non lo stesso sul conto sbagliato.\n        AND NOT public.fn_bank_codici_in_conflitto(r.descr, COALESCE(b.statement_description, b.description));';
  a2 text := E'      -- 431: gia'' confermato da un altro estratto dello stesso conto (primo giorno a meta'').\n      AND NOT (b.statement_id IS NOT NULL AND b.statement_id <> st.id AND b.transaction_date <= v_from + p_edge_days)\n';
BEGIN
  IF position(a1 in d) = 0 OR position(a2 in d) = 0 THEN RAISE EXCEPTION 'rollback 431: pezzi non trovati'; END IF;
  d := replace(replace(d, a1, ';'), a2, '');
  EXECUTE d;
END $$;
