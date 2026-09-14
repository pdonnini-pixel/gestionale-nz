-- 20260914_218 — Il vincolo della 192 torna nel motore (e stavolta si applica per patch)
--
-- COSA ERA SUCCESSO
-- La migration 192 (06/09/2026) aveva aggiunto una condizione sola: se una
-- scadenza e' chiusa a mano e ha una payment_date, il movimento candidato deve
-- cadere entro 30 giorni da quella data. Serve perche' la payment_date di una
-- chiusura manuale e' la data in cui UNA PERSONA ha detto che il pagamento e'
-- avvenuto: un movimento lontano mesi da quella data non e' quel pagamento.
--
-- Al controllo del 14/09 la condizione non c'era piu': in
-- try_match_bank_transaction la parola `closed_manually` non compariva affatto.
-- Una CREATE OR REPLACE successiva ha riscritto il corpo senza riportarla,
-- sostituendo il concetto con un piu' povero `(status = 'pagato') AS
-- is_closed_manual`, che guarda lo stato e ignora sia il flag sia la data.
--
-- Conseguenza misurata su NZ: un solo aggancio sbagliato, ed e' esattamente
-- quello per cui la 192 era nata. Spm Investigazioni fattura 31, chiusa a mano
-- con payment_date 06/08/2026, si e' ripresa il movimento del 09/03/2026:
-- 150 giorni di distanza.
--
-- E' la TERZA volta che una CREATE OR REPLACE su questa funzione cancella il
-- ramo di qualcun altro (vedi anche 209 -> 210). Per questo la 218 non
-- riscrive la funzione: legge la definizione viva dal catalogo, ci innesta la
-- condizione e la riapplica. Quello che c'e' dentro non lo tocca nessuno.

BEGIN;

DO $mig$
DECLARE
  v_src      text;
  v_new      text;
  v_pattern  text := 'AND NOT EXISTS \([^()]*payable_credit_note_links[^()]*\)';
  v_aggiunta text;
  v_conta    integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'try_match_bank_transaction';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'try_match_bank_transaction non trovata: niente da patchare';
  END IF;

  -- gia' applicata: la 218 e' idempotente
  IF position('closed_manually IS NOT TRUE' in v_src) > 0 THEN
    RAISE NOTICE '218: il vincolo e'' gia'' presente, nessuna modifica';
    RETURN;
  END IF;

  -- l'ancora deve esistere ed essere unica, altrimenti non si tocca niente
  SELECT count(*) INTO v_conta
    FROM regexp_matches(v_src, v_pattern, 'g');
  IF v_conta <> 1 THEN
    RAISE EXCEPTION '218: ancora trovata % volte invece di 1 — il corpo della funzione e'' cambiato, patch NON applicata', v_conta;
  END IF;

  v_aggiunta :=
    E'\\&\n'
    '      -- Migration 192, rimessa dalla 218 il 14/09/2026.\n'
    '      -- Una scadenza chiusa a mano porta la data in cui una PERSONA ha detto\n'
    '      -- che il pagamento e'' avvenuto. Un movimento lontano da quella data non\n'
    '      -- e'' quel pagamento, per quanto l''importo torni.\n'
    '      AND (payables.closed_manually IS NOT TRUE\n'
    '           OR payables.payment_date IS NULL\n'
    '           OR abs(payables.payment_date - v_bt.transaction_date) <= 30)';

  v_new := regexp_replace(v_src, v_pattern, v_aggiunta);

  IF position('closed_manually IS NOT TRUE' in v_new) = 0 THEN
    RAISE EXCEPTION '218: la sostituzione non ha prodotto il vincolo — patch NON applicata';
  END IF;

  EXECUTE v_new;
  RAISE NOTICE '218: vincolo rimesso in try_match_bank_transaction';
END
$mig$;

COMMIT;

-- VERIFICA (deve dare true su tutti e tre i tenant)
-- SELECT position('closed_manually IS NOT TRUE' in pg_get_functiondef(p.oid)) > 0 AS vincolo_presente,
--        position('fn_bank_own_movement' in pg_get_functiondef(p.oid)) > 0 AS ramo_movimenti_banca,
--        position('payable_credit_note_links' in pg_get_functiondef(p.oid)) > 0 AS ramo_note_credito
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.proname='try_match_bank_transaction';
