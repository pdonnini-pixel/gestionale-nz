-- ============================================================================
-- 369 — fn_cash_closing_compute: su Zago mancava una riga di commento
-- ============================================================================
-- Trovata chiudendo la parità del 09/11: a 333 allineata, NZ e Zago avevano ancora
-- impronte diverse. Scesa per gruppi (lettera iniziale → prefisso → funzione), la
-- differenza era **una sola funzione su 321** e dentro di lei **una sola riga**:
-- il commento «-- Mezzi di pagamento (senza le fatture), contanti, fatture», 62
-- caratteri, presente su NZ e assente su Zago. Il codice era identico riga per
-- riga: nessuna differenza di comportamento sulle chiusure di cassa.
--
-- Applicata con la patch sulla definizione viva (tecnica delle migration 218,
-- 219, 306 e 309): il testo si legge dal server, si corregge con un `replace()` e
-- si esegue **solo** se l'md5 combacia con quello di NZ
-- (869e175ce75b07bfc30a3b8fa82d5c0e). Se non combacia, eccezione e niente.
-- Idempotente: se è già identica non fa nulla.
--
-- ESITO: NZ e Zago 323 funzioni con impronta complessiva
-- 6069f016ed2d6816ac21488f1834f691, identica.
--
-- Made resta fuori dal confronto per la decisione del 03/11/2026 (due tenant, non
-- tre): è ferma alla 20261102_335 e non riceve più modifiche al database.
-- ============================================================================

DO $patch$
DECLARE
  v_s text;
  v_atteso text := '869e175ce75b07bfc30a3b8fa82d5c0e';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_s
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'fn_cash_closing_compute';
  IF v_s IS NULL THEN RAISE EXCEPTION 'fn_cash_closing_compute non trovata'; END IF;
  IF md5(v_s) = v_atteso THEN RAISE NOTICE 'gia'' identica a NZ'; RETURN; END IF;

  v_s := replace(v_s,
    E'  END IF;\n\n  SELECT\n    COALESCE(SUM(CASE WHEN ch.counts_in_total',
    E'  END IF;\n\n  -- Mezzi di pagamento (senza le fatture), contanti, fatture\n  SELECT\n    COALESCE(SUM(CASE WHEN ch.counts_in_total');

  IF md5(v_s) <> v_atteso THEN
    RAISE EXCEPTION 'la patch non produce il testo di NZ (ottenuto %): non applico niente', md5(v_s);
  END IF;

  EXECUTE v_s;
  RAISE NOTICE 'fn_cash_closing_compute allineata a NZ';
END
$patch$;
