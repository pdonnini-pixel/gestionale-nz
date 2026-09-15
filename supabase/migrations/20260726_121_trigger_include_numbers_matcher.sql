-- =====================================================================
-- Migrazione 121 — Trigger INSERT: includi il matcher a NUMERI (SDD cumulativi)
-- =====================================================================
-- Il trigger `trg_auto_reconcile_bank_transaction` (a ogni INSERT su bank_transactions)
-- provava: granitico a NOME → a punteggio → a importo anonimo. NON provava il matcher
-- granitico a NUMERI (migr. 120), quindi i movimenti importati durante il giorno con
-- SDD cumulativi (es. HERA) non si agganciavano subito e restavano "da riconciliare"
-- fino al cron delle 05:45.
--
-- FIX: dopo il granitico a nome (e prima del punteggio) prova anche il granitico a
-- NUMERI. Così ogni nuovo movimento importato — anche quello che non scrive il nome
-- del fornitore in causale — si aggancia subito alle fatture citate per numero.
--
-- (In parallelo, la edge function acube-ob-tx-sync lancia run_daily_reconciliation a
--  fine import per l'intera suite — biettivo, chiusure — non solo i granitici.)
--
-- Additiva/idempotente. NON distruttiva. ⚠️ REGOLA #0 — NZ + Made + Zago.
-- =====================================================================

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
      v_res := public.try_match_group_numbers_bank_transaction(NEW.id);  -- migr. 120: SDD cumulativi per numero
      IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
        v_res := public.try_match_bank_transaction(NEW.id);
        IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
          PERFORM public.try_match_amount_bank_transaction(NEW.id);
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
