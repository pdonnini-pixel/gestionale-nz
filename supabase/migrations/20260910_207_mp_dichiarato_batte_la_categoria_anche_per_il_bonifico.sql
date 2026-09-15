-- 20260910_207 — La modalita' dichiarata in fattura batte la categoria anche quando e' un bonifico
--
-- PERCHE' (Patrizio, 10/09/2026): «amazon viene pagato con bonifico».
-- La 201 aveva tolto alla categoria il potere di scavalcare un ADDEBITO DIRETTO dichiarato
-- (MP17/MP19/MP20), e in quella nota Amazon era citata come caso opposto, «dichiara MP05 ma
-- va a carta». Non e' cosi': in banca Amazon risulta pagata a bonifico, su tre conti diversi
-- e a saldo di piu' fatture insieme. La carta arrivava dalla categoria «Acquisti on line»,
-- che ha il flag auto_debit_card, e portava con se' la scadenza al 20 del mese dopo.
--
-- COSA CAMBIA: la regola diventa generale. Se la fattura dichiara un codice MP e quel codice
-- non e' MP08 (carta) ne' MP01 (contanti), decide lui; categoria e anagrafica fornitore
-- contano solo dove la fattura non dice niente. Per leggerlo, la funzione ora cattura
-- qualunque MPxx dall'XML (prima cercava solo MP08 e MP01).
-- MP08, MP01 e lo scontrino si comportano esattamente come prima.
--
-- PERIMETRO misurato su NZ prima di applicare: le scadenze aperte a carta con un MP diverso
-- da MP08/MP01 sono 11, tutte Amazon, per 371,22. Nessun altro fornitore cambia.
-- I dati sono nella 208, che va applicata DOPO questa. Rollback in _ROLLBACK.sql

CREATE OR REPLACE FUNCTION public.fn_payable_auto_debit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_xml_mp    text := NULL;
  v_mp        text;
  v_scontrino boolean := false;
  v_is_mp08   boolean;
  v_is_mp01   boolean;
  v_gia_sdd   boolean;
  v_altro     boolean;
  v_should    boolean;
  v_cat       boolean;
  v_sup       boolean;
BEGIN
  -- Nota: in Postgres il conteggio di ripetizione di un regex POSIX arriva a 255,
  -- {0,400} fa fallire l'espressione a runtime. Qui si resta sotto la soglia.
  IF NEW.electronic_invoice_id IS NOT NULL AND COALESCE(NEW.installment_total, 1) <= 1 THEN
    SELECT
      COALESCE(substring(e.xml_content from '"modalita_pagamento":\s*"(MP[0-9]{2})"'),
               substring(e.xml_content from '<ModalitaPagamento>(MP[0-9]{2})<')),
      COALESCE(e.xml_content ~* '("causale":\s*\[[^\]]{0,250}(scontrino|ricevuta fiscale)|<Causale>[^<]{0,250}(scontrino|ricevuta fiscale))', false)
    INTO v_xml_mp, v_scontrino
    FROM public.electronic_invoices e
    WHERE e.id = NEW.electronic_invoice_id;
  END IF;

  v_mp := COALESCE(NEW.payment_method_code, v_xml_mp);

  v_is_mp08 := COALESCE(NEW.payment_method_code = 'MP08', false) OR COALESCE(v_xml_mp = 'MP08', false);
  v_is_mp01 := COALESCE(NEW.payment_method_code = 'MP01', false) OR COALESCE(v_xml_mp = 'MP01', false)
               OR COALESCE(v_scontrino, false);

  -- Addebito diretto già dichiarato: esce da solo dal conto, alla sua data.
  v_gia_sdd := COALESCE(NEW.payment_method_code IN ('MP17','MP19','MP20'), false)
               OR COALESCE(NEW.payment_method::text IN ('rid','sdd_core','sdd_b2b'), false)
               OR COALESCE(NEW.payment_method::text LIKE 'riba\_%', false);

  -- Qualunque altro canale scritto in fattura (bonifico, assegno, Ri.Ba., MAV, bollettino):
  -- lo ha deciso il fornitore, non lo scavalca ne' la categoria ne' l'anagrafica.
  v_altro := v_mp IS NOT NULL AND v_mp NOT IN ('MP08', 'MP01')
             AND NOT v_is_mp08 AND NOT v_is_mp01;

  IF v_is_mp01 AND NOT v_is_mp08
     AND COALESCE(NEW.is_forecast, false) = false
     AND COALESCE(NEW.gross_amount, 0) > 0
     AND COALESCE(NEW.payment_method::text, '') <> 'contanti'
     AND COALESCE(NEW.status::text, 'da_pagare') NOT IN ('annullato','nota_credito','pagato','parziale','sospeso','bloccato')
  THEN
    NEW.payment_method := 'contanti'::payment_method;
    IF v_xml_mp = 'MP01' AND NEW.payment_method_code IS NULL THEN
      NEW.payment_method_code := 'MP01';
    END IF;
    RETURN NEW;
  END IF;

  v_should := v_is_mp08;

  -- La categoria e l'anagrafica fornitore decidono solo dove il canale non è già dichiarato.
  IF NOT v_should AND NOT v_gia_sdd AND NOT v_altro AND NEW.cost_category_id IS NOT NULL THEN
    SELECT COALESCE(c.auto_debit_card, false) INTO v_cat
    FROM public.cost_categories c WHERE c.id = NEW.cost_category_id;
    v_should := COALESCE(v_cat, false);
  END IF;

  IF NOT v_should AND NOT v_gia_sdd AND NOT v_altro AND NEW.supplier_id IS NOT NULL THEN
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
