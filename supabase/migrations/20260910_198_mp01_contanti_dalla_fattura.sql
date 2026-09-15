-- 20260910_198 — MP01 in fattura significa contanti, anche se il fornitore è a bonifico.
--
-- IL CASO (Patrizio, 10/09/2026). HOTEL INN, fattura 1972/26 del 15/07 da 77,00 €: nei dati
-- di pagamento la fattura dichiara «Contanti», e infatti `payment_method_code` = 'MP01' è
-- salvato correttamente. Ma il metodo della scadenza era rimasto `bonifico_ordinario`,
-- ereditato dal piano del fornitore, quindi la riga restava fra le Aperte come se ci fosse
-- un bonifico da disporre, e la regola dei contanti (migr. 197) non la vedeva nemmeno.
--
-- Il codice SDI veniva letto e conservato ma non tradotto nel metodo. Qui si traduce il
-- caso univoco e sicuro: MP01 → contanti. Il documento del fornitore ha la precedenza sul
-- default dell'anagrafica, perché dice cosa è successo davvero a quella fattura.
--
-- NON si toccano gli altri codici: MP12 (RiBa) non dice la variante 30/60/90/120, che
-- dipende dal piano del fornitore, e MP19/MP16 (SDD) hanno più varianti. Quelli restano da
-- guardare a mano, caso per caso.
-- Le DATE non vengono toccate: al resto pensa la 197, che chiude i contanti con la data
-- della fattura.
--
-- Additiva: estende il trigger già esistente. Rollback in _ROLLBACK.sql

CREATE OR REPLACE FUNCTION public.fn_payable_auto_debit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  -- COALESCE indispensabile: con payment_method_code NULL il confronto vale NULL e
  -- l'intera catena di IF si spegne in silenzio (migr. 196).
  v_is_mp08 boolean := COALESCE(NEW.payment_method_code = 'MP08', false);
  v_is_mp01 boolean := COALESCE(NEW.payment_method_code = 'MP01', false);
  v_should  boolean;
  v_cat     boolean;
  v_sup     boolean;
BEGIN
  -- (0) MP01: la fattura dice CONTANTI. Vince sul default del fornitore e sulla categoria,
  -- perché è il documento a dire come è stata pagata quella fornitura.
  IF v_is_mp01
     AND COALESCE(NEW.is_forecast, false) = false
     AND COALESCE(NEW.gross_amount, 0) > 0
     AND COALESCE(NEW.payment_method::text, '') <> 'contanti'
     AND COALESCE(NEW.status::text, 'da_pagare') NOT IN ('annullato','nota_credito','pagato','parziale','sospeso','bloccato')
  THEN
    NEW.payment_method := 'contanti'::payment_method;
    RETURN NEW;
  END IF;

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
    -- La carta addebita il 20 del mese successivo alla spesa: è quella la scadenza vera.
    NEW.due_date := (date_trunc('month', NEW.invoice_date) + interval '1 month' + interval '19 days')::date;
  END IF;
  RETURN NEW;
END;
$function$;
