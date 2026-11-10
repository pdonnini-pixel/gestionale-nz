-- ROLLBACK 390 — Distinta di rimborso
-- Riporta le funzioni com'erano prima della 390. La tabella
-- payable_reimbursements e la colonna payable_actions.rimborso_group_id NON si
-- tolgono (regola no data loss): senza le funzioni restano solo un'annotazione.

-- 5. Chiusura provvisoria: via la riga aggiunta.
DO $do$
DECLARE
  v_def text;
  v_aggiunta CONSTANT text :=
    E'      AND NOT EXISTS ( -- migration 390: in distinta di rimborso, non è uscita dalla carta\n'
    || E'        SELECT 1 FROM public.payable_actions ra\n'
    || E'        WHERE ra.payable_id = p.id AND ra.action_type = ''disposizione''\n'
    || E'          AND ra.rimborso_group_id IS NOT NULL)\n';
BEGIN
  v_def := pg_get_functiondef('public.fn_cash_card_provisional_close(uuid, boolean)'::regprocedure);
  IF position(v_aggiunta in v_def) > 0 THEN
    EXECUTE replace(v_def, v_aggiunta, '');
  END IF;
END;
$do$;

-- 4b. Giro notturno.
CREATE OR REPLACE FUNCTION public.rerun_distinta_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD;
  v_res jsonb;
  v_matched INT := 0;
  v_seen INT := 0;
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  PERFORM public.richiedi_profilo_gestionale(); -- migration 364
  FOR v_bt IN
    SELECT id FROM public.bank_transactions
    WHERE amount < 0
      AND COALESCE(is_reconciled, false) = false
      AND status IN ('posted', 'booked')
      AND transaction_date >= (CURRENT_DATE - INTERVAL '400 days')
    ORDER BY transaction_date DESC
  LOOP
    v_seen := v_seen + 1;
    v_res := public.try_match_distinta_bank_transaction(v_bt.id);
    IF COALESCE((v_res->>'matched')::boolean, false) THEN
      v_matched := v_matched + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('esaminati', v_seen, 'agganciati', v_matched);
END;
$function$;

-- 4a. Trigger sui movimenti.
CREATE OR REPLACE FUNCTION public.trg_auto_reconcile_bank_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE v_res jsonb;
BEGIN
  IF NEW.status IN ('posted', 'booked') AND NEW.amount < 0 THEN
    v_res := public.try_match_distinta_bank_transaction(NEW.id);
    IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
      v_res := public.try_match_group_bank_transaction(NEW.id);
      IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
        v_res := public.try_match_group_numbers_bank_transaction(NEW.id);
        IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
          v_res := public.try_match_bank_transaction(NEW.id);
          IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
            PERFORM public.try_match_amount_bank_transaction(NEW.id);
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. Conferma del beneficiario dalla distinta.
CREATE OR REPLACE FUNCTION public.payable_in_distinta_for_movement(p_payable_id uuid, p_bank_account_id uuid, p_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.payable_actions a
    WHERE a.payable_id = p_payable_id
      AND a.action_type = 'disposizione'
      AND (
        p_bank_account_id IS NULL
        OR a.bank_account_id IS NULL
        OR a.bank_account_id = p_bank_account_id
      )
      AND p_date BETWEEN (a.performed_at::date - 3) AND (a.performed_at::date + 20)
  );
$function$;

-- 2. L'aggancio del rimborso.
DROP FUNCTION IF EXISTS public.try_match_rimborso_bank_transaction(uuid);
