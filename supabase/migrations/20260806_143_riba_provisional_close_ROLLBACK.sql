-- ============================================================================
-- ROLLBACK 20260806_143_riba_provisional_close.sql
-- ----------------------------------------------------------------------------
-- Ripristina run_daily_reconciliation SENZA lo step RiBa, rimuove le funzioni
-- introdotte e (opzionale) le colonne. NON riapre le scadenze gia' chiuse in
-- via provvisoria: per riaprirle usare rpc_riba_provisional_undo prima del
-- rollback, oppure lo statement commentato in fondo.
-- ============================================================================

BEGIN;

-- run_daily_reconciliation torna alla versione senza RiBa
CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_group jsonb;
  v_bij jsonb;
  v_amt jsonb;
  v_close jsonb;
  v_util jsonb;
BEGIN
  v_group := public.rerun_group_reconciliation();
  v_bij := public.rerun_bijective_reconciliation();
  v_amt := public.rerun_amount_reconciliation();
  v_close := public.close_non_supplier_movements();
  v_util := public.close_utility_movements();
  RETURN jsonb_build_object('granitici', v_group, 'biettivo', v_bij, 'importo_anonimo', v_amt,
                            'chiusi_non_fornitore', v_close, 'chiusi_utenze', v_util, 'run_at', now());
END;
$function$;

DROP FUNCTION IF EXISTS public.rpc_riba_provisional_undo(uuid);
DROP FUNCTION IF EXISTS public.rpc_riba_provisional_close_backlog();
DROP FUNCTION IF EXISTS public.rerun_riba_provisional_close();
DROP FUNCTION IF EXISTS public.fn_riba_provisional_close(uuid, boolean);

-- update_payable_status: ripristina la versione senza azzeramento del flag
CREATE OR REPLACE FUNCTION public.update_payable_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.original_due_date := NEW.due_date;
  END IF;

  NEW.amount_remaining := NEW.gross_amount - COALESCE(NEW.amount_paid, 0);

  IF NEW.status = 'nota_credito' THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF NEW.status IN ('sospeso', 'annullato', 'bloccato') THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF NEW.status = 'rimandato' AND NEW.postponed_to IS NOT NULL THEN
    NEW.due_date := NEW.postponed_to;
    NEW.status := 'da_pagare';
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF NEW.amount_remaining <= 0 THEN
    NEW.status := 'pagato';
  ELSIF COALESCE(NEW.amount_paid, 0) > 0 AND NEW.amount_remaining > 0 THEN
    NEW.status := 'parziale';
  ELSIF COALESCE(NEW.is_auto_debit, false) THEN
    IF NEW.due_date <= CURRENT_DATE + 7 THEN
      NEW.status := 'in_scadenza';
    ELSE
      NEW.status := 'da_pagare';
    END IF;
  ELSIF NEW.due_date < CURRENT_DATE THEN
    NEW.status := 'scaduto';
  ELSIF NEW.due_date <= CURRENT_DATE + 7 THEN
    NEW.status := 'in_scadenza';
  ELSE
    NEW.status := 'da_pagare';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;

-- Colonne: lasciare per sicurezza (nessuna perdita dati). Per rimuoverle:
-- ALTER TABLE public.payables DROP COLUMN IF EXISTS provisional_paid_at;
-- ALTER TABLE public.payables DROP COLUMN IF EXISTS is_provisional_paid;
-- DROP INDEX IF EXISTS public.idx_payables_provisional_paid;

COMMIT;

-- Per riaprire in blocco le RiBa chiuse in via provvisoria (se serve):
-- UPDATE public.payables SET amount_paid = 0, payment_date = NULL,
--   is_provisional_paid = false, provisional_paid_at = NULL
-- WHERE is_provisional_paid = true;
