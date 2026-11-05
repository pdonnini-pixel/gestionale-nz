-- ROLLBACK 361 — torna allo stato della 360 (proposte superate chiuse come 'rejected').
UPDATE public.reconciliation_log SET status = 'rejected' WHERE status = 'superseded';

CREATE OR REPLACE FUNCTION public.fn_close_proposals_on_bt_reconciled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.reconciliation_log
     SET status = 'rejected',
         notes = COALESCE(notes, '') || ' | chiusa in automatico il ' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY')
                 || ': movimento già abbinato'
   WHERE bank_transaction_id = NEW.id
     AND company_id = NEW.company_id
     AND status = 'to_confirm';
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.payable_closed_for_proposals(p_status text, p_closed_manually boolean, p_bank_transaction_id uuid)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_status IN ('annullato', 'nota_credito')
      OR (p_status = 'pagato'
          AND NOT (COALESCE(p_closed_manually, false) AND p_bank_transaction_id IS NULL));
$function$;

CREATE OR REPLACE FUNCTION public.fn_close_proposals_on_payable_closed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.reconciliation_log
     SET status = 'rejected',
         notes = COALESCE(notes, '') || ' | chiusa in automatico il ' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY')
                 || ': fattura già ' || CASE WHEN NEW.status::text = 'pagato' THEN 'pagata' ELSE NEW.status::text END
   WHERE payable_id = NEW.id
     AND company_id = NEW.company_id
     AND status = 'to_confirm';
  RETURN NULL;
END;
$function$;

ALTER TABLE public.reconciliation_log DROP CONSTRAINT IF EXISTS reconciliation_log_status_check;
ALTER TABLE public.reconciliation_log ADD CONSTRAINT reconciliation_log_status_check
  CHECK (status = ANY (ARRAY['applied'::text, 'to_confirm'::text, 'rejected'::text]));
