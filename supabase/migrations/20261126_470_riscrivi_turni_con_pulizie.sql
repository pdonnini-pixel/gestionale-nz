-- 470 · turni_proposti_riscrivi ammette i turni dall'ora delle pulizie (26/11/2026, dopo la 468)
--
-- PERCHE': con le pulizie prima dell'apertura (outlet_servizi, tipo 'pulizie') il piano propone un
-- turno dalle 9 in un negozio che apre alle 10 (Valmontone lunedi' e venerdi'). Il controllo
-- dell'orario di turni_proposti_riscrivi (migration 411, ricalcolo dopo una ferie spostata o tolta)
-- rifiutava quel turno («esce dall'orario di apertura») e il ricalcolo andava in errore intero.
-- COSA: l'unica riga cambiata e' il controllo dell'inizio del turno: l'apertura diventa la piu'
-- presto fra l'apertura e l'inizio delle pulizie di quel giorno della settimana (al massimo 4 ore
-- prima, come applicaServizi nel frontend). Tutto il resto della funzione resta identico: si legge
-- la definizione viva, si sostituisce quel solo pezzo e si controlla che la sostituzione sia
-- avvenuta una volta sola (la 411 e' identica su NZ e Zago, md5 1211d572b64ad29144b32264e584ef7a).
-- NO DATA LOSS: solo CREATE OR REPLACE FUNCTION. ROLLBACK: _ROLLBACK.

BEGIN;

DO $$
DECLARE
  v_def  text := pg_get_functiondef('public.turni_proposti_riscrivi(uuid,date[],jsonb,jsonb)'::regprocedure);
  v_vec  text := $v$    IF (v_apre IS NOT NULL AND t.inizio < v_apre) OR (v_chiude IS NOT NULL AND t.fine > v_chiude) THEN$v$;
  v_nuo  text := $n$    -- pulizie prima dell'apertura (migration 468/470): il turno puo' cominciare all'ora delle pulizie
    IF v_apre IS NOT NULL THEN
      v_apre := LEAST(v_apre, COALESCE((SELECT sv.dalle FROM public.outlet_servizi sv
                                         WHERE sv.outlet_id = pl.outlet_id AND sv.tipo = 'pulizie'
                                           AND sv.giorno = extract(isodow FROM t.data)::int
                                           AND sv.dalle < v_apre AND sv.dalle >= v_apre - interval '4 hours'
                                         ORDER BY sv.dalle LIMIT 1), v_apre));
    END IF;
$n$ || $v$    IF (v_apre IS NOT NULL AND t.inizio < v_apre) OR (v_chiude IS NOT NULL AND t.fine > v_chiude) THEN$v$;
BEGIN
  IF (length(v_def) - length(replace(v_def, v_vec, ''))) / length(v_vec) <> 1 THEN
    RAISE EXCEPTION '470: il controllo dell''orario in turni_proposti_riscrivi non è quello atteso: non cambio niente';
  END IF;
  EXECUTE replace(v_def, v_vec, v_nuo);
END $$;

COMMIT;

-- VERIFICA: SELECT pg_get_functiondef('public.turni_proposti_riscrivi(uuid,date[],jsonb,jsonb)'::regprocedure) LIKE '%outlet_servizi%';  -- true
