-- =====================================================================
-- ROLLBACK 443 — torna indietro sulla guardia delle coppie escluse
-- =====================================================================
-- Toglie i controlli dalle quattro funzioni e lascia la tabella al suo posto,
-- vuota o piena: non si cancella, perché dentro ci sono decisioni di persone
-- («questo movimento non è di questa fattura»), che sono dato vero. Se serve
-- davvero buttarla, lo si fa a parte, con la conferma di Patrizio.
--
-- Le funzioni si rimettono come prima con la stessa tecnica: si legge il testo
-- vivo e si tolgono le righe innestate, senza riscrivere niente a mano. Ogni
-- blocco si ferma se non trova quello che deve togliere.
-- =====================================================================

BEGIN;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.undo_reconcile_movement(uuid)'::regprocedure) INTO v_def;
  v_new := replace(v_def,
$o$
    -- 443: questa coppia l'ha esclusa una persona. Il motore non la rifà.
    PERFORM public.escludi_coppia(v_log.bank_transaction_id, v_log.payable_id,
      'annullato a mano il ' || to_char(now(), 'DD/MM/YYYY') || ' (solo aggancio)');
$o$, '');
  v_new := replace(v_new,
$o$
  -- 443: questa coppia l'ha esclusa una persona. Il motore non la rifà.
  PERFORM public.escludi_coppia(v_log.bank_transaction_id, v_log.payable_id,
    'annullato a mano il ' || to_char(now(), 'DD/MM/YYYY'));
$o$, '');
  IF v_new ~ 'escludi_coppia' THEN
    RAISE EXCEPTION 'undo_reconcile_movement: non ho trovato le righe da togliere';
  END IF;
  EXECUTE v_new;
END
$patch$;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.reconcile_movement(uuid,uuid,uuid)'::regprocedure) INTO v_def;
  v_new := replace(v_def,
$o$
  -- 443: coppia esclusa da una persona. Qui si ferma chiunque chiami, cron e
  -- persone comprese: un giro di massa lanciato da una persona (ImportHub, che
  -- chiama rerun_reconciliation col token di chi lo lancia) non è una decisione
  -- su questa coppia. Per rifarla a mano si chiama prima riammetti_coppia, che
  -- è un gesto esplicito su questa coppia e sola.
  IF public.coppia_esclusa(p_bt_id, p_payable_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'coppia_esclusa');
  END IF;
$o$, '');
  IF v_new ~ 'coppia_esclusa' THEN
    RAISE EXCEPTION 'reconcile_movement: non ho trovato le righe da togliere';
  END IF;
  EXECUTE v_new;
END
$patch$;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.rerun_bijective_reconciliation()'::regprocedure) INTO v_def;
  v_new := replace(v_def,
$o$
      -- 443: le coppie escluse da una persona non tornano.
      AND NOT public.coppia_esclusa(bt.id, v_pay.id)$o$, '');
  IF v_new ~ 'coppia_esclusa' THEN
    RAISE EXCEPTION 'rerun_bijective_reconciliation: non ho trovato le righe da togliere';
  END IF;
  EXECUTE v_new;
END
$patch$;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.try_match_amount_bank_transaction(uuid)'::regprocedure) INTO v_def;
  v_new := replace(v_def,
$o$      -- 443: le coppie escluse da una persona non tornano. Qui serve perché il
      -- 06/09/2026 questo ramo ha rifatto l'aggancio GRUPPO SERVIZI 315,00 che
      -- il giorno prima era stato annullato a mano.
      AND NOT public.coppia_esclusa(p_bt_id, p.id)
$o$, '');
  IF v_new ~ 'coppia_esclusa' THEN
    RAISE EXCEPTION 'try_match_amount_bank_transaction: non ho trovato le righe da togliere';
  END IF;
  EXECUTE v_new;
END
$patch$;

COMMIT;

-- La tabella e le tre funzioni di servizio restano. Per togliere anche quelle,
-- con la conferma di Patrizio e dopo una SELECT di backup delle righe:
--   DROP FUNCTION IF EXISTS public.riammetti_coppia(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.escludi_coppia(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.coppia_esclusa(uuid, uuid);
--   DROP TABLE IF EXISTS public.reconciliation_coppie_escluse;
--
-- Nota: con il rollback il frontend non cambia. `reconcile_movement` non
-- risponde più `coppia_esclusa`, quindi la domanda «vuoi rifarlo adesso?» in
-- Riconciliazione semplicemente non compare più.
