-- ============================================================================
-- 368 — Zago in pari: la guardia 333 arriva anche qui
-- ============================================================================
-- La 333 (una proposta `to_confirm` già in elenco non si riscrive) era su NZ e su
-- Made dal 02/11, ma non su Zago: i due tentativi di applicarla, il 02/11 e la
-- mattina del 09/11, sono finiti in timeout perché il connettore chiede
-- un'approvazione e non c'era nessuno davanti allo schermo. Verificato ogni volta
-- che su Zago non fosse entrato niente di parziale.
--
-- Applicata il 09/11 con Patrizio presente. Due passaggi, perché il primo invio
-- aveva perso la riga di commento dentro la funzione (l'avevo riscritta a mano
-- invece di copiare il testo di NZ): il secondo riallinea il testo al carattere.
-- La morale è quella di sempre su questa parte: **il testo non si riscrive, si
-- copia da `pg_get_functiondef` del tenant di riferimento.**
--
-- Esito: su NZ e Zago `reclog_skip_duplicate_proposal` ha impronta
-- 330ad5e1696f8ced222897d53c5f6616 e il trigger 9fa6d30a43bb1a9bb66efc6ddc2e3b2f.
--
-- Nota: su Zago non si è potuta rifare la prova sul vivo della 333 (tre
-- inserimenti della stessa coppia) perché il tenant non ha ancora movimenti
-- bancari: `bank_transactions` è vuota. La prova resta quella fatta su NZ il
-- 02/11, e il testo delle due funzioni è identico al carattere.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reclog_skip_duplicate_proposal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_conf numeric;
BEGIN
  -- Solo le proposte aperte con entrambi i lati valorizzati: tutto il resto passa.
  IF NEW.status IS DISTINCT FROM 'to_confirm'
     OR NEW.bank_transaction_id IS NULL
     OR NEW.payable_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT r.id, r.confidence
    INTO v_id, v_conf
    FROM public.reconciliation_log r
   WHERE r.status = 'to_confirm'
     AND r.bank_transaction_id = NEW.bank_transaction_id
     AND r.payable_id = NEW.payable_id
     AND r.company_id IS NOT DISTINCT FROM NEW.company_id
   ORDER BY r.confidence DESC NULLS LAST, r.performed_at DESC
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.confidence, 0) > COALESCE(v_conf, 0) THEN
    UPDATE public.reconciliation_log
       SET confidence = NEW.confidence,
           match_type = NEW.match_type,
           applied_amount = NEW.applied_amount,
           notes = NEW.notes,
           performed_at = now()
     WHERE id = v_id;
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reclog_skip_duplicate_proposal ON public.reconciliation_log;
CREATE TRIGGER trg_reclog_skip_duplicate_proposal
  BEFORE INSERT ON public.reconciliation_log
  FOR EACH ROW EXECUTE FUNCTION public.reclog_skip_duplicate_proposal();
