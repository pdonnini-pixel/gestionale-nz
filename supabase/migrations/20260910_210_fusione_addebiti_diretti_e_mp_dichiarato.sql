-- 20260910_210 — Fusione: la 209 (addebiti diretti automatici) e la 207 (il codice MP
-- dichiarato batte la categoria anche quando è un bonifico) toccavano la STESSA funzione,
-- in due sessioni parallele. Applicate a pochi minuti di distanza, l'ultima ha cancellato
-- il lavoro della prima: dopo la 209 il ramo v_altro della 207 non c'era più, e le fatture
-- Amazon, che dichiarano MP05 ma appartengono a una categoria marcata «si paga con carta»,
-- sarebbero tornate a carta al primo aggiornamento. Qui le due logiche stanno insieme.
--
-- Cosa tiene, dalla 207:
--   · v_xml_mp cattura QUALUNQUE codice MPxx dichiarato in fattura, non solo MP08 e MP01;
--   · v_altro — un canale dichiarato dal fornitore (bonifico, assegno, MAV, bollettino)
--     non lo scavalca né la categoria né l'anagrafica.
-- Cosa tiene, dalla 209:
--   · la lista COMPLETA e verificata degli addebiti diretti (MP09, MP10, MP11, MP16, MP17,
--     MP19, MP20, MP21 — MP20 è SDD CORE, non la RiBa, che è MP12);
--   · un addebito diretto si marca is_auto_debit e NON gli si tocca la scadenza, perché
--     esce alla sua data e non il 20 del mese successivo come la carta;
--   · quando il documento dichiara un addebito diretto e la colonna è rimasta sul bonifico
--     d'ufficio, la colonna si allinea (rid, sdd_core, sdd_b2b).
--
-- Nota sui numeri: la 209 è registrata sui tre tenant col nome «20260910_205
-- addebiti_diretti_sono_automatici», perché quando fu applicata il numero 205 risultava
-- libero. Il file nel repo porta il 209 per non collidere con la 205 dell'altra sessione.
--
-- Nessun dato cancellato. Rollback in _ROLLBACK.sql

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
