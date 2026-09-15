-- 20260910_201 — Un addebito diretto dichiarato in fattura non diventa «carta».
--
-- PERCHÉ. Con la 200 la categoria si legge dalle righe della fattura. Subito dopo, una
-- fattura UnipolTech di telepedaggio (91,85 €) è finita in «mezzi e carburante», categoria
-- marcata auto_debit_card: il trigger l'ha portata a carta di credito e ne ha spostato la
-- scadenza dall'11/09 al 20/10. Ma quella fattura dichiara MP19, cioè RID: l'addebito
-- arriva sul conto alla sua data, non sull'estratto carta del mese dopo. Il canale
-- dichiarato dal fornitore è un'informazione più forte della categoria di costo.
--
-- COSA CAMBIA. La strada «categoria» e la strada «fornitore» non scavalcano più un
-- addebito diretto già dichiarato: MP19 (RID), MP20 (RIBA), MP17 (domiciliazione) o una
-- colonna payment_method già impostata su rid, sdd_core, sdd_b2b o una RiBa. Restano
-- intoccate: MP08, che porta a carta come prima; le fatture senza codice, dove la
-- categoria continua a decidere (è il caso BELLUCO, gasolio senza modalità); e i fornitori
-- come Amazon, che dichiarano MP05 e vanno a carta per anagrafica.
--
-- Nessun dato cancellato. Rollback in _ROLLBACK.sql

CREATE OR REPLACE FUNCTION public.fn_payable_auto_debit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_xml_mod   text := NULL;
  v_scontrino boolean := false;
  v_is_mp08   boolean;
  v_is_mp01   boolean;
  v_gia_sdd   boolean;
  v_should    boolean;
  v_cat       boolean;
  v_sup       boolean;
BEGIN
  -- Nota: in Postgres il conteggio di ripetizione di un regex POSIX arriva a 255,
  -- {0,400} fa fallire l'espressione a runtime. Qui si resta sotto la soglia.
  IF NEW.electronic_invoice_id IS NOT NULL AND COALESCE(NEW.installment_total, 1) <= 1 THEN
    SELECT
      CASE
        WHEN e.xml_content ~ '(<ModalitaPagamento>MP08</ModalitaPagamento>|"modalita_pagamento":\s*"MP08")' THEN 'MP08'
        WHEN e.xml_content ~ '(<ModalitaPagamento>MP01</ModalitaPagamento>|"modalita_pagamento":\s*"MP01")' THEN 'MP01'
        ELSE NULL
      END,
      COALESCE(e.xml_content ~* '("causale":\s*\[[^\]]{0,250}(scontrino|ricevuta fiscale)|<Causale>[^<]{0,250}(scontrino|ricevuta fiscale))', false)
    INTO v_xml_mod, v_scontrino
    FROM public.electronic_invoices e
    WHERE e.id = NEW.electronic_invoice_id;
  END IF;

  v_is_mp08 := COALESCE(NEW.payment_method_code = 'MP08', false) OR COALESCE(v_xml_mod = 'MP08', false);
  v_is_mp01 := COALESCE(NEW.payment_method_code = 'MP01', false) OR COALESCE(v_xml_mod = 'MP01', false)
               OR COALESCE(v_scontrino, false);

  -- Addebito diretto già dichiarato: esce da solo dal conto, alla sua data.
  v_gia_sdd := COALESCE(NEW.payment_method_code IN ('MP17','MP19','MP20'), false)
               OR COALESCE(NEW.payment_method::text IN ('rid','sdd_core','sdd_b2b'), false)
               OR COALESCE(NEW.payment_method::text LIKE 'riba\_%', false);

  IF v_is_mp01 AND NOT v_is_mp08
     AND COALESCE(NEW.is_forecast, false) = false
     AND COALESCE(NEW.gross_amount, 0) > 0
     AND COALESCE(NEW.payment_method::text, '') <> 'contanti'
     AND COALESCE(NEW.status::text, 'da_pagare') NOT IN ('annullato','nota_credito','pagato','parziale','sospeso','bloccato')
  THEN
    NEW.payment_method := 'contanti'::payment_method;
    IF v_xml_mod = 'MP01' AND NEW.payment_method_code IS NULL THEN
      NEW.payment_method_code := 'MP01';
    END IF;
    RETURN NEW;
  END IF;

  v_should := v_is_mp08;

  -- La categoria e l'anagrafica fornitore decidono solo dove il canale non è già dichiarato.
  IF NOT v_should AND NOT v_gia_sdd AND NEW.cost_category_id IS NOT NULL THEN
    SELECT COALESCE(c.auto_debit_card, false) INTO v_cat
    FROM public.cost_categories c WHERE c.id = NEW.cost_category_id;
    v_should := COALESCE(v_cat, false);
  END IF;

  IF NOT v_should AND NOT v_gia_sdd AND NEW.supplier_id IS NOT NULL THEN
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
