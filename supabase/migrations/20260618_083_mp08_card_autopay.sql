-- ════════════════════════════════════════════════════════════════════
-- 083 — Fatture passive pagate con carta (MP08) = già pagate + partitario
-- Applicata ai 3 tenant (NZ/Made/Zago).
--
-- FatturaPA ModalitaPagamento MP08 = "Carta di pagamento" (carta credito/debito,
-- pagamento in tempo reale): la fattura è già saldata, non deve comparire come
-- aperta nello scadenzario. Regola: si chiude E si registra nel partitario, sempre.
--
-- Implementazione centralizzata via 2 trigger su payables, così vale per OGNI
-- percorso di creazione (sync_acube_sdi_passive_to_payable, fn_invoice_to_payable,
-- inserimenti manuali) senza duplicare la logica, e integra con la dedup:
--  - se fn_prevent_duplicate_payable annulla l'INSERT (duplicato), l'AFTER trigger
--    non scatta → niente doppia registrazione;
--  - righe annullate/manuali (pagate/parziali/sospese/bloccate) non vengono toccate.
--
-- (1) BEFORE INSERT — gira PRIMA di trg_payable_status (che ricalcola lo status
--     dal residuo: amount_remaining<=0 → 'pagato'). Il nome 'trg_mp08_autopay'
--     precede 'trg_payable_status' nell'ordine alfabetico dei trigger.
-- (2) AFTER INSERT — registra la riga payable_actions (idempotente).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_mp08_autopay()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Solo carta di pagamento MP08, riga reale e non già lavorata/manuale.
  IF NEW.payment_method_code = 'MP08'
     AND COALESCE(NEW.is_forecast, false) = false
     AND COALESCE(NEW.gross_amount, 0) > 0
     AND COALESCE(NEW.amount_paid, 0) = 0
     AND COALESCE(NEW.status::text, 'da_pagare') NOT IN ('annullato','nota_credito','pagato','parziale','sospeso','bloccato')
  THEN
    NEW.amount_paid    := NEW.gross_amount;                       -- → residuo 0 → 'pagato' (trg_payable_status)
    NEW.payment_date   := COALESCE(NEW.payment_date, NEW.invoice_date);
    NEW.payment_method := 'carta_credito'::payment_method;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mp08_autopay ON public.payables;
CREATE TRIGGER trg_mp08_autopay
  BEFORE INSERT ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.fn_mp08_autopay();

CREATE OR REPLACE FUNCTION public.fn_mp08_register_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.payment_method_code = 'MP08'
     AND NEW.status = 'pagato'
     AND COALESCE(NEW.is_forecast, false) = false
     AND NOT EXISTS (SELECT 1 FROM public.payable_actions a WHERE a.payable_id = NEW.id AND a.action_type = 'payment')
  THEN
    INSERT INTO public.payable_actions (payable_id, action_type, amount, new_status, payment_method, note, performed_at)
    VALUES (NEW.id, 'payment', NEW.gross_amount, 'pagato'::payable_status, 'carta_credito'::payment_method,
            'Pagato con carta (MP08) - automatico', now());
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mp08_register_payment ON public.payables;
CREATE TRIGGER trg_mp08_register_payment
  AFTER INSERT ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.fn_mp08_register_payment();
