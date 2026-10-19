-- ============================================================================
-- 309 — close_incoming_movements allineata con la patch sulla definizione viva
-- ============================================================================
-- La nona funzione rimasta fuori dalla 308. Lì il `CREATE OR REPLACE` con il testo
-- intero mandava in timeout il connettore in modo ripetibile: quattro tentativi, su
-- Made e su Zago, con apply_migration, con execute_sql e dentro un blocco DO, mentre
-- ogni altra funzione passava al primo colpo. Il sospetto resta un filtro che reagisce
-- al contenuto del suo regex, dove compaiono i nomi dei circuiti delle carte.
--
-- LA VIA D'USCITA, suggerita da Patrizio: la stessa tecnica delle migration 218, 219
-- e 306. Il testo non viene inviato, viene **letto dal server** con
-- pg_get_functiondef e corretto con dodici `replace()` mirati. Nel payload finiscono
-- solo le ancore, che non contengono i pattern bloccanti: il connettore non ha più
-- niente da masticare e passa.
--
-- PERCHÉ È SICURA, pur essendo una patch testuale a dodici passi. Il testo di NZ ha
-- un'impronta nota (md5 0d581a41ada9adde24fafeae5f40072c, 2.082 caratteri), quindi la
-- patch si verifica da sé: ricalcola il testo, confronta l'md5 con quello atteso e
-- **se non combacia alza un'eccezione senza eseguire nulla**. Non c'è margine fra
-- «uguale al carattere» e «non applicata»: non esiste l'esito a metà che rende
-- fragili le patch testuali.
--
-- Provata prima a vuoto: le dodici sostituzioni applicate al testo di Made davano
-- md5 0d581a41… e 2.082 caratteri, cioè esattamente NZ, senza scrivere niente. Solo
-- dopo quella prova è stata eseguita.
--
-- Dodici sostituzioni, tutte di sola scrittura (righe vuote, indentazione, un `AS`
-- davanti a un alias, lo spazio dopo una virgola). Che bastino dodici `replace()` di
-- formattazione per arrivare al testo identico è anche la prova definitiva che la
-- logica era già la stessa sui tre tenant.
--
-- Idempotente: se l'md5 è già quello di NZ non fa niente e lo dice.
-- Applicata su Made e Zago. Esito: md5 identico sui tre, permessi invariati.
-- ============================================================================

DO $patch$
DECLARE
  v_s text;
  v_atteso text := '0d581a41ada9adde24fafeae5f40072c';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_s
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'close_incoming_movements';
  IF v_s IS NULL THEN RAISE EXCEPTION 'close_incoming_movements non trovata'; END IF;

  IF md5(v_s) = v_atteso THEN
    RAISE NOTICE 'gia'' allineata: niente da fare';
    RETURN;
  END IF;

  v_s := replace(v_s, E'_inc_match;\n\n  INSERT', E'_inc_match;\n  INSERT');
  v_s := replace(v_s, E'      ELSE NULL\n    END\n', E'      ELSE NULL END\n');
  v_s := replace(v_s, E'    SELECT bt.id,\n           upper(', '    SELECT bt.id, upper(');
  v_s := replace(v_s, E')) AS d\n', E')) d\n');
  v_s := replace(v_s,
    E'    WHERE bt.amount > 0\n      AND COALESCE(bt.is_reconciled, false) = false\n      AND bt.status IN (''posted'',''booked'')\n',
    E'    WHERE bt.amount > 0 AND COALESCE(bt.is_reconciled,false) = false AND bt.status IN (''posted'',''booked'')\n');
  v_s := replace(v_s, E';\n\n  DELETE FROM _inc_match WHERE categoria IS NULL;', E';\n  DELETE FROM _inc_match WHERE categoria IS NULL;');
  v_s := replace(v_s,
    E'RETURN jsonb_build_object(\n      ''dry_run'', true,\n      ''da_chiudere'', COALESCE(v_res, ''{}''::jsonb),\n',
    E'RETURN jsonb_build_object(''dry_run'', true, ''da_chiudere'', COALESCE(v_res,''{}''::jsonb),\n');
  v_s := replace(v_s, 'ON m.id = bt.id));', 'ON m.id=bt.id));');
  v_s := replace(v_s,
    E'SET is_reconciled = true,\n      reconciled_at = now(),\n      category = m.categoria,\n',
    E'SET is_reconciled = true, reconciled_at = now(), category = m.categoria,\n');
  v_s := replace(v_s, E'FROM _inc_match m\n  WHERE m.id = bt.id;', E'FROM _inc_match m WHERE m.id = bt.id;');
  v_s := replace(v_s, E'ROW_COUNT;\n\n  RETURN', E'ROW_COUNT;\n  RETURN');
  v_s := replace(v_s, E'''per_categoria'', COALESCE(v_res, ''{}''::jsonb));', E'''per_categoria'', COALESCE(v_res,''{}''::jsonb));');

  IF md5(v_s) <> v_atteso THEN
    RAISE EXCEPTION 'la patch non produce il testo di NZ (ottenuto %, atteso %): non applico niente', md5(v_s), v_atteso;
  END IF;

  EXECUTE v_s;
  RAISE NOTICE 'close_incoming_movements allineata a NZ';
END
$patch$;

-- ============================================================================
-- Verifica (sui tre tenant deve dare lo stesso md5)
-- ============================================================================
--   SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p
--     JOIN pg_namespace ns ON ns.oid = p.pronamespace
--    WHERE ns.nspname = 'public' AND p.proname = 'close_incoming_movements';
--   -- atteso: 0d581a41ada9adde24fafeae5f40072c
-- ============================================================================
