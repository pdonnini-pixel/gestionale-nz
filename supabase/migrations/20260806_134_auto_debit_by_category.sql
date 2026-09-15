-- ════════════════════════════════════════════════════════════════════
-- 134 — Addebito automatico anche per CATEGORIA (oltre a MP08)
-- Applicare ai 3 tenant (NZ/Made/Zago). Additiva, non distruttiva.
--
-- CONTESTO (richiesta Patrizio, 2026-08-06)
-- Alcune categorie di costo si pagano SEMPRE con carta (es. "Mezzi e
-- carburante": carta di credito/prepagata). Vanno trattate come addebito
-- automatico anche se la fattura non riporta MP08: non compaiono come
-- scadenza da pagare a mano, restano nel saldo come uscita prevista, e si
-- chiudono quando si carica l'estratto conto delle carte (riconciliazione).
--
-- Implementazione:
--  (1) cost_categories.auto_debit_card — flag "questa categoria si paga con
--      carta" (gestibile dal pannello Gestisci categorie). Impostato su
--      MEZZI_E_CARBURANTE dove presente (code standard → tenant-safe).
--  (2) fn_payable_auto_debit — generalizza fn_mp08_autopay: marca is_auto_debit
--      se il metodo è MP08 (codice o XML della fattura) OPPURE se la categoria
--      del payable ha auto_debit_card=true. Gira su INSERT E UPDATE, così vale
--      anche quando la categoria viene assegnata dopo (a mano dallo Scadenzario).
--      Imposta due_date = 20 del mese successivo SOLO alla transizione (non
--      sovrascrive modifiche manuali successive). La riconciliazione (amount_paid>0)
--      non viene toccata (guardia amount_paid=0).
-- ════════════════════════════════════════════════════════════════════

-- (1) Flag categoria "si paga con carta" ────────────────────────────
ALTER TABLE public.cost_categories
  ADD COLUMN IF NOT EXISTS auto_debit_card boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cost_categories.auto_debit_card IS
  'true = le fatture di questa categoria si pagano con carta (addebito automatico): trattate come is_auto_debit, non compaiono come scadenza da pagare a mano, si chiudono con l''estratto conto carte.';

-- Categoria "Mezzi e carburante": sempre a carta. code standard → si applica
-- solo dove la categoria esiste (NZ; Made/Zago no-op).
UPDATE public.cost_categories SET auto_debit_card = true
WHERE code = 'MEZZI_E_CARBURANTE' AND auto_debit_card = false;

-- (2) Rilevamento addebito automatico: MP08 OR categoria-carta ───────
CREATE OR REPLACE FUNCTION public.fn_payable_auto_debit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_mp08 boolean := (NEW.payment_method_code = 'MP08');
  v_should  boolean;
  v_cat     boolean;
BEGIN
  -- MP08 dall'XML della fattura elettronica (quando il bridge non ha popolato
  -- payment_method_code): solo rata unica.
  IF NOT v_is_mp08
     AND NEW.electronic_invoice_id IS NOT NULL
     AND COALESCE(NEW.installment_total, 1) <= 1 THEN
    SELECT (e.xml_content ~ '<ModalitaPagamento>MP08</ModalitaPagamento>')
      INTO v_is_mp08
    FROM public.electronic_invoices e
    WHERE e.id = NEW.electronic_invoice_id;
    v_is_mp08 := COALESCE(v_is_mp08, false);
  END IF;

  v_should := v_is_mp08;

  -- Categoria marcata "si paga con carta".
  IF NOT v_should AND NEW.cost_category_id IS NOT NULL THEN
    SELECT COALESCE(c.auto_debit_card, false) INTO v_cat
    FROM public.cost_categories c WHERE c.id = NEW.cost_category_id;
    v_should := COALESCE(v_cat, false);
  END IF;

  -- Applica solo alla TRANSIZIONE (is_auto_debit ancora false), su righe reali
  -- aperte e non pagate. Così non ricalcolo due_date a ogni update né tocco la
  -- riconciliazione (amount_paid>0).
  IF v_should
     AND COALESCE(NEW.is_forecast, false) = false
     AND COALESCE(NEW.gross_amount, 0) > 0
     AND COALESCE(NEW.amount_paid, 0) = 0
     AND COALESCE(NEW.status::text, 'da_pagare') NOT IN ('annullato','nota_credito','pagato','parziale','sospeso','bloccato')
     AND NOT COALESCE(NEW.is_auto_debit, false)
  THEN
    NEW.is_auto_debit := true;
    IF v_is_mp08 THEN NEW.payment_method_code := 'MP08'; END IF;
    NEW.payment_method := 'carta_credito'::payment_method;
    NEW.due_date := (date_trunc('month', NEW.invoice_date) + interval '1 month' + interval '19 days')::date;
  END IF;
  RETURN NEW;
END;
$function$;

-- Sostituisce il trigger BEFORE INSERT trg_mp08_autopay con uno BEFORE
-- INSERT OR UPDATE (cattura anche la categoria assegnata dopo l'import).
DROP TRIGGER IF EXISTS trg_mp08_autopay ON public.payables;
DROP TRIGGER IF EXISTS trg_payable_auto_debit ON public.payables;
CREATE TRIGGER trg_payable_auto_debit
  BEFORE INSERT OR UPDATE ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.fn_payable_auto_debit();

DROP FUNCTION IF EXISTS public.fn_mp08_autopay();
