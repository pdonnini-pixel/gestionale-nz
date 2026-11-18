-- 434 — Documenti banca: un movimento già confermato dall'estratto del SUO conto non è «lo stesso
-- movimento sul conto sbagliato». NZ + Zago.
--
-- Il fatto (Zago, 18/11/2026, estratti BCC Pontassieve gennaio-ottobre). Firenze (…604178) e Forte
-- dei Marmi (…604305) sono due conti della stessa banca con commissioni, canone e bolli identici
-- negli stessi giorni («Commissioni su bonifico tramite in» 0,75, «Canone mensile tenuta conto» 8,00,
-- «Imposta di bollo al 31/03/2026» 25,00), e incassi POS di pari importo stanno anche su MPS. Una riga
-- dell'estratto di Forte che non si ritrovava sul suo conto veniva fermata come «riga_su_altro_conto»
-- (NON inserita, domanda in chat) perché su Firenze c'era il gemello. 40 domande in un giorno, tutte
-- false: in ognuna il candidato sull'altro conto era già stato confermato o inserito dall'estratto
-- del proprio conto (bank_transactions.statement_id valorizzato). Le causali BCC non portano codici
-- identificativi, quindi il controllo 431 (fn_bank_codici_in_conflitto) non bastava.
--
-- Regola: il candidato sull'altro conto vale solo se NESSUN estratto del suo conto lo ha già
-- certificato (statement_id IS NULL). Un movimento certificato dal documento della sua banca è suo
-- (R27, gerarchia delle fonti: il documento della banca comanda). statement_id è scritto solo da
-- apply_bank_statement e solo sul conto dell'estratto: verificato su NZ (1.706) e Zago (2.530), 0
-- righe con statement_id di un altro conto.
-- Misura prima di applicare: NZ 0 domande «riga_su_altro_conto» aperte; Zago 40, tutte con candidato
-- certificato. Nessun dato toccato da questa migration.
-- Tecnica come la 431: si sostituisce un solo pezzo nella definizione viva (md5 5e86f658… identico su
-- NZ e Zago); se il pezzo non si trova la migration si ferma.

DO $$
DECLARE
  d text := pg_get_functiondef('public.apply_bank_statement(uuid, jsonb, numeric, numeric, integer)'::regprocedure);
  a1 text := E'        AND NOT public.fn_bank_codici_in_conflitto(r.descr, COALESCE(b.statement_description, b.description));';
  b1 text := E'        AND NOT public.fn_bank_codici_in_conflitto(r.descr, COALESCE(b.statement_description, b.description))\n        -- 434: gia'' certificato dall''estratto del suo conto = movimento di quel conto, non questo.\n        AND b.statement_id IS NULL;';
BEGIN
  IF position(b1 in d) > 0 THEN RAISE NOTICE '434: gia'' applicata'; RETURN; END IF;
  IF position(a1 in d) = 0 THEN RAISE EXCEPTION '434: pezzo non trovato in apply_bank_statement'; END IF;
  d := replace(d, a1, b1);
  EXECUTE d;
END $$;
