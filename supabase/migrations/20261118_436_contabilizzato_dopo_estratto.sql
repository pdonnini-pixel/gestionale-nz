-- 436 — Documenti banca: non si chiede «c'è nell'estratto?» per un movimento che un altro estratto dello
-- stesso conto certifica con data contabile successiva al periodo. NZ + Zago.
--
-- Il fatto (Zago, 18/11/2026, BCC Forte dei Marmi): un addebito American Express di 206,30 e la sua
-- commissione di 1,00 hanno valuta 15/07 ma la banca li ha contabilizzati il 06/08; l'estratto di agosto
-- li certifica (booking_date 06/08). Riapplicando l'estratto di luglio cadevano nel suo periodo per data
-- valuta e diventavano due domande «movimento_non_in_estratto», più 207,30 di scarto: false. Su NZ 10
-- domande di questo tipo in passato, tutte già chiuse.
-- Regola: come per l'open banking (postingDate dopo l'ultimo giorno dell'estratto, già nella funzione),
-- un movimento confermato da un altro estratto dello stesso conto con booking_date dopo v_to sta in
-- quell'estratto: non si chiede e non entra nello scarto. Vale per il conteggio e per le domande.
-- Tecnica come 431 e 434: si sostituisce un pezzo nella definizione viva; se non c'è ci si ferma.
-- Nessun dato toccato.

DO $$
DECLARE
  d text := pg_get_functiondef('public.apply_bank_statement(uuid, jsonb, numeric, numeric, integer)'::regprocedure);
  a1 text := E'      AND NOT (b.statement_id IS NOT NULL AND b.statement_id <> st.id AND b.transaction_date <= v_from + p_edge_days)';
  b1 text := E'      AND NOT (b.statement_id IS NOT NULL AND b.statement_id <> st.id AND b.transaction_date <= v_from + p_edge_days)\n      -- 436: contabilizzato dopo questo estratto e confermato dal suo: sta nell''estratto successivo.\n      AND NOT (b.statement_id IS NOT NULL AND b.statement_id <> st.id AND b.booking_date > v_to)';
BEGIN
  IF position(b1 in d) > 0 THEN RAISE NOTICE '436: gia'' applicata'; RETURN; END IF;
  IF position(a1 in d) = 0 THEN RAISE EXCEPTION '436: pezzo non trovato in apply_bank_statement'; END IF;
  d := replace(d, a1, b1);
  EXECUTE d;
END $$;
