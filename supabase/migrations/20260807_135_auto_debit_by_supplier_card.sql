-- ════════════════════════════════════════════════════════════════════
-- 135 — Addebito automatico anche da FORNITORE a carta
-- Applicare ai 3 tenant (NZ/Made/Zago). Additiva, non distruttiva.
--
-- CONTESTO (Patrizio, 2026-08-07)
-- Alcune fatture di fornitori a carta NON riportano la ModalitaPagamento
-- nell'XML (nessun blocco DatiPagamento: es. ALTOMUGELLO fatt. 1976) e non
-- appartengono a una categoria marcata "carta" → sfuggivano al rilevamento e
-- comparivano come "Scaduto". Ma il FORNITORE è configurato a carta
-- (default_payment_method / payment_method = carta_credito|carta_debito):
-- è quello il segnale affidabile.
--
-- Aggiunge un terzo criterio a fn_payable_auto_debit: se il fornitore del
-- payable è configurato a carta, il payable diventa addebito automatico
-- (come MP08 e come le categorie a carta). Nessun altro cambiamento.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_payable_auto_debit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_mp08 boolean := (NEW.payment_method_code = 'MP08');
  v_should  boolean;
  v_cat     boolean;
  v_sup     boolean;
BEGIN
  -- (1) MP08 dall'XML della fattura elettronica (bridge senza payment_method_code).
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

  -- (2) Categoria marcata "si paga con carta".
  IF NOT v_should AND NEW.cost_category_id IS NOT NULL THEN
    SELECT COALESCE(c.auto_debit_card, false) INTO v_cat
    FROM public.cost_categories c WHERE c.id = NEW.cost_category_id;
    v_should := COALESCE(v_cat, false);
  END IF;

  -- (3) Fornitore configurato a carta (metodo di default o metodo del fornitore).
  IF NOT v_should AND NEW.supplier_id IS NOT NULL THEN
    SELECT (s.default_payment_method IN ('carta_credito','carta_debito')
            OR s.payment_method IN ('carta_credito','carta_debito'))
      INTO v_sup
    FROM public.suppliers s WHERE s.id = NEW.supplier_id;
    v_should := COALESCE(v_sup, false);
  END IF;

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
