-- =====================================================================
-- Migrazione 103 — Riconciliazione: processare anche i movimenti 'booked'
-- =====================================================================
-- CAUSA RADICE (verificata): i movimenti di Open Banking A-Cube arrivano con
-- status = 'booked' (contabilizzato). Ma il trigger di auto-riconciliazione e i
-- batch (rerun_reconciliation, rerun_group_reconciliation) filtravano solo
-- status = 'posted'. Su NZ: 2.084 uscite 'booked' contro 82 'posted', quindi
-- ~1.998 movimenti NON venivano MAI valutati dal motore. Da qui la sensazione
-- che "le riconciliazioni non funzionano": la stragrande maggioranza dei
-- movimenti non entrava nemmeno nel motore.
--
-- FIX: trattare 'posted' E 'booked' come stati contabilizzati validi per il
-- matching (resta escluso 'pending', non ancora regolato). Corretti: il trigger
-- e i due batch. Le funzioni di matching per singolo movimento non filtrano lo
-- status internamente, quindi non serve toccarle.
--
-- Additiva/idempotente. NON distruttiva. ⚠️ REGOLA #0 — NZ + Made + Zago.
-- Dopo l'apply:
--   SELECT public.rerun_group_reconciliation();   -- auto granitici (sicuro)
--   -- e, se si vogliono rigenerare i suggerimenti a punteggio sullo storico:
--   -- SELECT public.rerun_reconciliation();
-- =====================================================================

-- 1) Trigger: prova prima il match granitico, poi quello a punteggio; su 'posted'+'booked'.
CREATE OR REPLACE FUNCTION public.trg_auto_reconcile_bank_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF NEW.status IN ('posted', 'booked') AND NEW.amount < 0 THEN
    v_res := public.try_match_group_bank_transaction(NEW.id);
    IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
      PERFORM public.try_match_bank_transaction(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 2) Batch a punteggio: include 'booked'.
CREATE OR REPLACE FUNCTION public.rerun_reconciliation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_processed INT := 0;
  v_matched INT := 0;
  v_result jsonb;
BEGIN
  FOR r IN
    SELECT id FROM public.bank_transactions
    WHERE amount < 0 AND status IN ('posted', 'booked')
      AND id NOT IN (SELECT bank_transaction_id FROM public.reconciliation_log WHERE bank_transaction_id IS NOT NULL)
  LOOP
    v_processed := v_processed + 1;
    v_result := public.try_match_bank_transaction(r.id);
    IF (v_result->>'matched')::boolean THEN
      v_matched := v_matched + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'matched', v_matched);
END;
$$;

-- 3) Batch granitico: include 'booked'.
CREATE OR REPLACE FUNCTION public.rerun_group_reconciliation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_proc INT := 0;
  v_match INT := 0;
  v_linked INT := 0;
  v_res jsonb;
BEGIN
  FOR r IN
    SELECT id FROM public.bank_transactions
    WHERE amount < 0 AND status IN ('posted', 'booked') AND COALESCE(is_reconciled, false) = false
  LOOP
    v_proc := v_proc + 1;
    v_res := public.try_match_group_bank_transaction(r.id);
    IF COALESCE((v_res->>'matched')::boolean, false) THEN
      v_match := v_match + 1;
      v_linked := v_linked + COALESCE((v_res->>'linked')::int, 0);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('processed', v_proc, 'matched', v_match, 'fatture_agganciate', v_linked);
END;
$$;
