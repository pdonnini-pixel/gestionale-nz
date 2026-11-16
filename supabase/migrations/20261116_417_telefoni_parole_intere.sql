-- =====================================================================
-- 417 — Telefoni per indirizzo della linea: comune e via solo come parole intere
-- =====================================================================
-- Dal revisore-database sulla 416 (16/11/2026): position() trovava il comune
-- anche dentro un'altra parola («como» in «comodato», «roma» in «romagna») e
-- dava la fattura al negozio sbagliato. Ora comune e via devono comparire come
-- parole intere (\m ... \M, come le trasferte del passaggio 1b); i caratteri
-- che non sono lettere, cifre o spazi si cercano alla lettera.
-- Nessun effetto oggi: il passaggio vale solo con le parti uguali (Zago) e
-- Zago non ha ancora fatture d'acquisto.
-- Due sostituzioni verificate, idempotente. Rollback: si rimettono le due
-- righe con position() (vedi _ROLLBACK).
-- =====================================================================

DO $migr$
DECLARE
  v_def text := pg_get_functiondef('public.fn_riparto_automatico(uuid,boolean)'::regprocedure);
  a1 text := $a$WHERE (length(n.comune) >= 3 AND position(n.comune IN i.txt) > 0)$a$;
  b1 text := $a$WHERE (length(n.comune) >= 3 AND i.txt ~ ('\m' || regexp_replace(n.comune, '([^a-z0-9à-ù ])', '\\\1', 'g') || '\M'))$a$;
  a2 text := $a$OR (length(n.via) >= 8 AND position(n.via IN i.txt) > 0)) AS outs$a$;
  b2 text := $a$OR (length(n.via) >= 8 AND i.txt ~ ('\m' || regexp_replace(n.via, '([^a-z0-9à-ù ])', '\\\1', 'g') || '\M'))) AS outs$a$;
BEGIN
  IF position(b1 IN v_def) > 0 AND position(b2 IN v_def) > 0 THEN
    RAISE NOTICE '417: funzione già aggiornata, niente da fare';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     OR (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 THEN
    RAISE EXCEPTION '417: la definizione di fn_riparto_automatico non è quella attesa (serve la 416), nessuna modifica';
  END IF;
  EXECUTE replace(replace(v_def, a1, b1), a2, b2);
END
$migr$;
