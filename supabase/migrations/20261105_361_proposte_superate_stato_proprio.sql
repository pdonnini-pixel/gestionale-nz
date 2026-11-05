-- ============================================================================
-- 361 — Proposte superate: stato proprio, non «rifiutata»
-- ============================================================================
-- Correzione della 360 dopo la revisione del 05/11/2026. La 360 chiudeva le
-- proposte superate come 'rejected'. Per il motore (`try_match_bank_transaction`,
-- migration 213 e 356) e per la pagina Banche (`rejectedPairs` in
-- TesoreriaManuale.tsx) 'rejected' vuol dire «una persona ha detto no a questa
-- coppia»: la coppia non viene riproposta mai più. Se un abbinamento veniva poi
-- annullato (`undo_reconcile_movement`) o una fattura riaperta, la proposta giusta
-- non sarebbe più tornata.
--
-- COSA CAMBIA
-- 1. Nuovo stato 'superseded' («superata») ammesso dal CHECK di
--    reconciliation_log.status: modifica additiva, nessun valore esistente cambia
--    significato.
-- 2. I due trigger della 360 scrivono 'superseded' invece di 'rejected'.
-- 3. Le 125 righe chiuse dalla pulizia della 360 su NZ (riconoscibili dalla nota
--    « | chiusa in automatico il ») passano da 'rejected' a 'superseded'. Su Zago 0.
--
-- 'superseded' non è letto da nessuna funzione né dalla pagina: non è una
-- proposta da mostrare e non blocca una riproposta. Se il movimento torna libero,
-- il motore notturno può riproporre la coppia (la 333 deduplica solo le
-- 'to_confirm').
--
-- Tenant: NZ e Zago (Made escluso dal 03/11/2026).
-- Rollback: 20261105_361_proposte_superate_stato_proprio_ROLLBACK.sql
-- ============================================================================

ALTER TABLE public.reconciliation_log DROP CONSTRAINT IF EXISTS reconciliation_log_status_check;
ALTER TABLE public.reconciliation_log ADD CONSTRAINT reconciliation_log_status_check
  CHECK (status = ANY (ARRAY['applied'::text, 'to_confirm'::text, 'rejected'::text, 'superseded'::text]));

CREATE OR REPLACE FUNCTION public.fn_close_proposals_on_bt_reconciled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.reconciliation_log
     SET status = 'superseded',
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
     SET status = 'superseded',
         notes = COALESCE(notes, '') || ' | chiusa in automatico il ' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY')
                 || ': fattura già ' || CASE WHEN NEW.status::text = 'pagato' THEN 'pagata' ELSE NEW.status::text END
   WHERE payable_id = NEW.id
     AND company_id = NEW.company_id
     AND status = 'to_confirm';
  RETURN NULL;
END;
$function$;


UPDATE public.reconciliation_log
   SET status = 'superseded'
 WHERE status = 'rejected'
   AND notes LIKE '% | chiusa in automatico il %';
