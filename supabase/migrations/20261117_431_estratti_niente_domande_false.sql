-- 431 — Documenti banca: niente domande false su «altro conto» e «non nell'estratto»
-- NZ + Zago. Nata il 17/11/2026 dagli otto estratti MPS di Zago (gennaio-novembre 2026): 22 domande
-- nel riquadro «Da chiarire», tutte false (regola granitica «niente liste da compilare a mano»).
--
-- 1) riga_su_altro_conto (16 su 22). Una riga dell'estratto che non si ritrova sul suo conto veniva
--    fermata (e NON inserita) se su un altro conto c'era un movimento con lo stesso importo entro 3
--    giorni. Erano tutte coincidenze fra Firenze e Forte: accrediti POS con codice SIA diverso
--    (…-00001 contro …-00002), addebiti Nexi con numero SDD diverso, bolli con Rif Banca diverso,
--    stipendi con ID flusso CBI diverso. Ora il candidato sull'altro conto non vale se i codici che
--    identificano il movimento (codice causale MPS «(09)», SIA, SDD, Rif Banca, flusso CBI, bonifico
--    SEPA, carta) sono presenti in tutte e due le causali e sono diversi: fn_bank_codici_in_conflitto.
--    Misura: le 16 domande di Zago risultano tutte in conflitto; su NZ 0 conflitti fra la causale
--    dell'estratto e quella dell'open banking dello stesso movimento (1.352) e 0 su 2.024 righe di
--    estratto gia' abbinate al loro movimento.
-- 2) movimento_non_in_estratto (6 su 22). Gli Excel MPS si fermano a 200 righe, quindi il primo
--    giorno di un file e' spesso a meta': i movimenti di quel giorno che stanno nel file precedente
--    venivano chiesti come «nel gestionale ma non nell'estratto». Ora un movimento dei primi giorni del
--    file (fino a p_edge_days dalla prima data) gia' confermato da un altro estratto dello stesso conto
--    (bank_transactions.statement_id diverso) non si chiede e non entra nello scarto. In mezzo al
--    periodo la domanda resta (revisore-database, 17/11/2026).
-- La funzione si modifica sostituendo solo questi pezzi nella definizione viva (identica su NZ e
-- Zago, md5 d4cf86553e3ca46680db971301e8b758): se un pezzo non si trova la migration si ferma.
-- Nessun dato cancellato. Rollback: 20261117_431_..._ROLLBACK.sql.

CREATE OR REPLACE FUNCTION public.fn_bank_codici_in_conflitto(p_a text, p_b text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Vero se le due causali portano lo stesso tipo di codice identificativo con valori diversi:
  -- allora sono due movimenti diversi, per quanto importo e data coincidano.
  SELECT COALESCE(bool_or(x IS NOT NULL AND y IS NOT NULL AND x <> y), false)
  FROM (VALUES
          ('^\s*\((\d{2})\)'),
          ('COD\.?\s*SIA:?\s*\d+-(\d{5})'),
          ('SDD\s+N\.?\s*(\d{5,})'),
          ('RIF\.?\s*BANCA:?\s*(\d{6,})'),
          ('ID\s+FLUSSO\s+CBI:?\s*(\d{5,})'),
          ('BON\.?\s*SEPA\s*(\d{6,})'),
          ('CARTA\s*(\d{6,})')
       ) AS p(re)
  CROSS JOIN LATERAL (SELECT (regexp_match(upper(COALESCE(p_a, '')), p.re))[1] AS x,
                             (regexp_match(upper(COALESCE(p_b, '')), p.re))[1] AS y) v;
$function$;
REVOKE ALL ON FUNCTION public.fn_bank_codici_in_conflitto(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bank_codici_in_conflitto(text, text) TO authenticated, service_role;

DO $$
DECLARE
  d text := pg_get_functiondef('public.apply_bank_statement(uuid, jsonb, numeric, numeric, integer)'::regprocedure);
  a1 text := E'        AND b.bank_account_id IS DISTINCT FROM st.bank_account_id\n        AND b.transaction_date BETWEEN r.e - 3 AND r.e + 3\n        AND CASE WHEN r.sk THEN b.amount = r.amt ELSE abs(b.amount) = abs(r.amt) END;';
  b1 text := E'        AND b.bank_account_id IS DISTINCT FROM st.bank_account_id\n        AND b.transaction_date BETWEEN r.e - 3 AND r.e + 3\n        AND CASE WHEN r.sk THEN b.amount = r.amt ELSE abs(b.amount) = abs(r.amt) END\n        -- 431: codici identificativi diversi = movimento diverso, non lo stesso sul conto sbagliato.\n        AND NOT public.fn_bank_codici_in_conflitto(r.descr, COALESCE(b.statement_description, b.description));';
  a2 text := E'      AND NOT (b.id = ANY (v_pending))\n      AND NOT COALESCE(b.raw_data->>''status'' = ''pending'', false)';
  b2 text := E'      AND NOT (b.id = ANY (v_pending))\n      -- 431: gia'' confermato da un altro estratto dello stesso conto (primo giorno a meta'').\n      AND NOT (b.statement_id IS NOT NULL AND b.statement_id <> st.id AND b.transaction_date <= v_from + p_edge_days)\n      AND NOT COALESCE(b.raw_data->>''status'' = ''pending'', false)';
BEGIN
  IF position(a1 in d) = 0 THEN RAISE EXCEPTION '431: pezzo 1 non trovato in apply_bank_statement'; END IF;
  IF position(a2 in d) = 0 THEN RAISE EXCEPTION '431: pezzo 2 non trovato in apply_bank_statement'; END IF;
  d := replace(replace(d, a1, b1), a2, b2);
  EXECUTE d;
END $$;
