-- ROLLBACK migrazione 121 — ripristina il trigger senza il matcher a numeri (versione 110).

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
      v_res := public.try_match_bank_transaction(NEW.id);
      IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
        PERFORM public.try_match_amount_bank_transaction(NEW.id);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
