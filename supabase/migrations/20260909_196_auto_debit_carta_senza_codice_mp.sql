-- 20260909_196 — L'addebito a carta smetteva di funzionare quando la fattura non dichiara
-- la modalità di pagamento.
--
-- IL CASO (Patrizio, 10/09/2026). LA COMPAGNIA DEL PROSCIUTTO, categoria «Viaggi e
-- trasferte» che è marcata «si paga con carta»: le scadenze comparivano come «Bonifico
-- ordinario» con scadenza a 30 giorni fine mese, invece che come addebito su carta.
--
-- LA CAUSA è una riga di fn_payable_auto_debit (migr. 134/135):
--   v_is_mp08 boolean := (NEW.payment_method_code = 'MP08');
-- Quando payment_method_code è NULL — cioè quando la fattura elettronica non porta il
-- blocco DatiPagamento, che è il caso della maggioranza delle fatture: 745 su NZ — quel
-- confronto vale NULL, non false. Da lì in avanti ogni «IF NOT v_is_mp08» e ogni
-- «IF NOT v_should» è NULL, quindi FALSO: i due criteri successivi, la CATEGORIA marcata
-- a carta e il FORNITORE configurato a carta, non venivano nemmeno valutati.
-- In pratica funzionava solo il criterio (1), l'MP08 esplicito.
--
-- IL FIX è il COALESCE su quel confronto. Nient'altro cambia.
--
-- Impatto misurato su NZ prima di applicare: 125 scadenze avrebbero dovuto essere marcate
-- a carta e non lo erano; 121 sono già pagate e restano come sono (il trigger non tocca le
-- scadenze chiuse), le 4 ancora aperte valgono 398,53 € e vengono rimarcate a parte.
--
-- Additiva: sostituisce una sola funzione trigger. Rollback in _ROLLBACK.sql

CREATE OR REPLACE FUNCTION public.fn_payable_auto_debit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  -- COALESCE indispensabile: con payment_method_code NULL il confronto vale NULL e
  -- l'intera catena di IF si spegne in silenzio (vedi intestazione della migration).
  v_is_mp08 boolean := COALESCE(NEW.payment_method_code = 'MP08', false);
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
    -- La carta addebita il 20 del mese successivo alla spesa: è quella la scadenza vera.
    NEW.due_date := (date_trunc('month', NEW.invoice_date) + interval '1 month' + interval '19 days')::date;
  END IF;
  RETURN NEW;
END;
$function$;
