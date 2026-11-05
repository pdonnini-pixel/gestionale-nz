-- ============================================================================
-- 360 — Le proposte di abbinamento si chiudono quando la cosa è già fatta
-- ============================================================================
-- Regola fissata da Patrizio il 05/11/2026: «quando ci sono le proposte del
-- gestionale non devono rimanere: se una cosa la chiudi a mano, la levi anche da
-- lì, se no uno ci va per errore».
--
-- Il motore scrive in `reconciliation_log` le proposte da confermare
-- (`status = 'to_confirm'`). Quando il movimento viene abbinato altrove o la
-- fattura viene pagata, la proposta resta aperta per sempre. La pagina Banche le
-- nasconde già (`isSuggestionActionable` in src/lib/reconcileMatch.ts), ma nel
-- database restano: il 05/11/2026 su NZ erano 133 proposte aperte, di cui 125 su
-- cose già chiuse (85 con il movimento già abbinato, 29 con la fattura pagata,
-- 11 con la fattura pagata e già agganciata a un altro movimento). Su Zago 0.
--
-- COSA FA
-- 1. Trigger su `bank_transactions`: quando un movimento passa a riconciliato,
--    le sue proposte ancora aperte diventano `rejected`.
-- 2. Trigger su `payables`: quando una fattura passa a chiusa, le sue proposte
--    ancora aperte diventano `rejected`. «Chiusa» vuol dire annullata, nota di
--    credito, oppure pagata, salvo la pagata a mano senza movimento agganciato:
--    per quella la pagina cerca ancora il bonifico (`isClosedManualUnlinked`), e la
--    proposta serve. Le rate parziali restano aperte.
-- 3. Pulizia una tantum delle proposte già superate, con la stessa regola.
--
-- Le funzioni che confermano una proposta (`reconcile_movement` con p_log_id) la
-- portano a `applied` DOPO aver aggiornato movimento e fattura, quindi la riga
-- confermata finisce comunque `applied`: il trigger chiude solo le altre.
--
-- NIENTE DELETE: le righe restano, cambia lo stato e in coda alla nota si scrive
-- il motivo con la data. Per riaprirle: status = 'to_confirm' sulle righe con
-- «chiusa in automatico» nella nota.
--
-- Tenant: NZ e Zago (Made escluso dal 03/11/2026).
-- Rollback: 20261105_360_proposte_chiuse_con_la_riconciliazione_ROLLBACK.sql
-- ============================================================================

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

REVOKE ALL ON FUNCTION public.fn_close_proposals_on_bt_reconciled() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_close_proposals_on_payable_closed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payable_closed_for_proposals(text, boolean, uuid) TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_close_proposals_on_bt_reconciled ON public.bank_transactions;
CREATE TRIGGER trg_close_proposals_on_bt_reconciled
  AFTER UPDATE OF is_reconciled ON public.bank_transactions
  FOR EACH ROW
  WHEN (COALESCE(NEW.is_reconciled, false) AND NOT COALESCE(OLD.is_reconciled, false))
  EXECUTE FUNCTION public.fn_close_proposals_on_bt_reconciled();

DROP TRIGGER IF EXISTS trg_close_proposals_on_payable_closed ON public.payables;
CREATE TRIGGER trg_close_proposals_on_payable_closed
  AFTER UPDATE ON public.payables
  FOR EACH ROW
  WHEN (public.payable_closed_for_proposals(NEW.status::text, NEW.closed_manually, NEW.bank_transaction_id)
        AND NOT public.payable_closed_for_proposals(OLD.status::text, OLD.closed_manually, OLD.bank_transaction_id))
  EXECUTE FUNCTION public.fn_close_proposals_on_payable_closed();

-- Pulizia una tantum delle proposte già superate.
UPDATE public.reconciliation_log r
   SET status = 'rejected',
       notes = COALESCE(r.notes, '') || ' | chiusa in automatico il ' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY')
               || CASE WHEN COALESCE(b.is_reconciled, false) THEN ': movimento già abbinato'
                       ELSE ': fattura già chiusa' END
               || ' (pulizia 360)'
  FROM public.bank_transactions b, public.payables p
 WHERE r.status = 'to_confirm'
   AND b.id = r.bank_transaction_id
   AND p.id = r.payable_id
   AND (COALESCE(b.is_reconciled, false)
        OR public.payable_closed_for_proposals(p.status::text, p.closed_manually, p.bank_transaction_id));
