-- 363: una scelta fatta a mano sul metodo di pagamento di una scadenza non viene più
-- riscritta dal trigger. Categoria (auto_debit_card) e anagrafica fornitore decidono la
-- carta solo all'inserimento o quando cambiano categoria o fornitore.
-- Caso: L'Undicesimo (Viaggi e trasferte), fatture 306 e 339 da pagare con bonifico:
-- ogni UPDATE a bonifico tornava a carta_credito + is_auto_debit.
-- Tenant: NZ + Zago (Made escluso dal 03/11/2026).
-- Applicata su NZ e Zago il 05/11/2026 con il nome 20261105_362_metodo_scelto_a_mano_resta
-- (numero poi rinominato in 363 per non sovrapporsi alla 362 già su main; i commenti
-- nel corpo citano ancora «Migration 362»).
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
  v_regole    boolean;
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

  -- Addebito diretto: esce dal conto da solo, per mandato, alla SUA data.
  -- Lista dei codici SDI verificata: MP09 RID, MP10 RID utenze, MP11 RID veloce,
  -- MP16 domiciliazione bancaria, MP17 domiciliazione postale, MP19 SEPA Direct Debit,
  -- MP20 SDD CORE, MP21 SDD B2B. La RiBa è MP12 e resta fuori: ha il suo meccanismo.
  v_gia_sdd := COALESCE(v_mp IN ('MP09','MP10','MP11','MP16','MP17','MP19','MP20','MP21'), false)
               OR COALESCE(NEW.payment_method::text IN ('rid','sdd_core','sdd_b2b'), false)
               OR COALESCE(NEW.payment_method::text LIKE 'riba\_%', false);

  -- Qualunque altro canale scritto in fattura (bonifico, assegno, Ri.Ba., MAV, bollettino):
  -- lo ha deciso il fornitore, non lo scavalca né la categoria né l'anagrafica.
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

  -- Un addebito diretto si marca come automatico: esce dalla lista dei bonifici da
  -- disporre e dal totale da pagare. La scadenza resta la sua. La RiBa ha il suo
  -- meccanismo (migr. 146), quindi qui si marcano solo rid e SDD.
  IF v_gia_sdd AND NOT v_is_mp08
     AND COALESCE(NEW.payment_method::text, '') NOT LIKE 'riba\_%'
     AND COALESCE(NEW.is_forecast, false) = false
     AND COALESCE(NEW.gross_amount, 0) > 0
     AND COALESCE(NEW.amount_paid, 0) = 0
     AND COALESCE(NEW.status::text, 'da_pagare') NOT IN ('annullato','nota_credito','pagato','parziale','sospeso','bloccato')
  THEN
    -- La fattura è la fonte, la colonna è una copia (R18).
    IF NEW.payment_method_code IS NULL AND v_xml_mp IS NOT NULL THEN
      NEW.payment_method_code := v_xml_mp;
    END IF;
    IF COALESCE(NEW.payment_method::text, '') IN ('', 'bonifico_ordinario', 'bonifico_sepa', 'altro') THEN
      NEW.payment_method := CASE v_mp
                              WHEN 'MP20' THEN 'sdd_core'::payment_method
                              WHEN 'MP21' THEN 'sdd_b2b'::payment_method
                              ELSE 'rid'::payment_method
                            END;
    END IF;
    NEW.is_auto_debit := true;
    RETURN NEW;
  END IF;

  v_should := v_is_mp08;

  -- Migration 362: categoria e anagrafica sono valori di ripiego, non una scelta umana.
  -- Valgono quando la scadenza nasce, o quando cambiano categoria o fornitore.
  -- Una modifica successiva fatta a mano (per esempio da carta a bonifico, dalla
  -- matita dello Scadenzario) non viene più riscritta a ogni salvataggio.
  v_regole := TG_OP = 'INSERT'
              OR NEW.cost_category_id IS DISTINCT FROM OLD.cost_category_id
              OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id;

  -- La categoria e l'anagrafica fornitore decidono solo dove il canale non è già dichiarato.
  IF v_regole AND NOT v_should AND NOT v_gia_sdd AND NOT v_altro AND NEW.cost_category_id IS NOT NULL THEN
    SELECT COALESCE(c.auto_debit_card, false) INTO v_cat
    FROM public.cost_categories c WHERE c.id = NEW.cost_category_id;
    v_should := COALESCE(v_cat, false);
  END IF;

  IF v_regole AND NOT v_should AND NOT v_gia_sdd AND NOT v_altro AND NEW.supplier_id IS NOT NULL THEN
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
