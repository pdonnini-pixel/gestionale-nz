-- 20260910_199 — Leggere la modalità di pagamento DENTRO la fattura, e riconoscere le
-- fatture emesse a fronte di uno scontrino.
--
-- I CASI (Patrizio, 10/09/2026), tutti e tre ancora aperti in Scadenzario come «bonifico»:
--   • Linea Ufficio di MASI, FT 001902 (126,05 €): l'XML dichiara MP01, contanti, ma la
--     colonna payment_method_code della scadenza è VUOTA, quindi la regola della migr. 198
--     — che guardava solo quella colonna — non la vedeva.
--   • MAGLIONE, D988 (24,47 €): nessuna modalità dichiarata, ma la causale dice «Fattura in
--     riferimento scontrino n. 21 del 23/06/2026 MF.: 147577IEB99». Se c'è uno scontrino la
--     fornitura è già stata pagata alla cassa: non c'è nessun bonifico da disporre.
--   • Only The Food, XR-141 (15,90 €): l'XML dichiara MP08, carta.
--
-- LA CAUSA COMUNE. Il trigger leggeva l'XML solo per MP08 e solo col pattern del formato
-- XML puro (`<ModalitaPagamento>MP08</ModalitaPagamento>`), mentre le fatture che arrivano
-- dal bridge A-Cube sono salvate in JSON (`"modalita_pagamento": "MP08"`). Quel ramo quindi
-- non trovava mai niente, e per MP01 non esisteva proprio.
--
-- COSA FA ORA: legge la modalità dall'XML in tutti e due i formati, riconosce lo scontrino
-- (e la ricevuta fiscale) nella CAUSALE, e riporta il codice trovato in
-- payment_method_code, così la colonna dice davvero cosa c'è scritto sul documento.
--
-- Attenzione al perimetro: «scontrino» e «ricevuta fiscale» si cercano SOLO nella causale.
-- Cercarli in tutto l'XML dava falsi positivi grossolani, per esempio le fatture REALCART
-- che nelle righe scrivono «Corrispettivo non comprensivo del contributo ambientale Conai».
--
-- ATTENZIONE al regex: in Postgres il conteggio di ripetizione POSIX arriva a 255. Un
-- {0,400} non dà errore in fase di CREATE FUNCTION, esplode a runtime al primo INSERT o
-- UPDATE su payables ("invalid repetition count(s)"): la tabella diventa di sola lettura.
-- È successo qui, corretto in pochi minuti con la 199b; da allora i contatori stanno sotto 255.
--
-- Additiva: estende il trigger esistente. Rollback in _ROLLBACK.sql

CREATE OR REPLACE FUNCTION public.fn_payable_auto_debit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_xml_mod   text := NULL;      -- modalità letta dentro la fattura (XML o JSON A-Cube)
  v_scontrino boolean := false;  -- fattura emessa a fronte di scontrino / ricevuta fiscale
  v_is_mp08   boolean;
  v_is_mp01   boolean;
  v_should    boolean;
  v_cat       boolean;
  v_sup       boolean;
BEGIN
  -- Lettura del documento: un solo accesso, due formati (XML puro e JSON del bridge A-Cube).
  IF NEW.electronic_invoice_id IS NOT NULL AND COALESCE(NEW.installment_total, 1) <= 1 THEN
    SELECT
      CASE
        WHEN e.xml_content ~ '(<ModalitaPagamento>MP08</ModalitaPagamento>|"modalita_pagamento":\s*"MP08")' THEN 'MP08'
        WHEN e.xml_content ~ '(<ModalitaPagamento>MP01</ModalitaPagamento>|"modalita_pagamento":\s*"MP01")' THEN 'MP01'
        ELSE NULL
      END,
      COALESCE(e.xml_content ~* '("causale":\s*\[[^]]{0,400}(scontrino|ricevuta fiscale)|<Causale>[^<]{0,250}(scontrino|ricevuta fiscale))', false)
    INTO v_xml_mod, v_scontrino
    FROM public.electronic_invoices e
    WHERE e.id = NEW.electronic_invoice_id;
  END IF;

  v_is_mp08 := COALESCE(NEW.payment_method_code = 'MP08', false) OR COALESCE(v_xml_mod = 'MP08', false);
  v_is_mp01 := COALESCE(NEW.payment_method_code = 'MP01', false) OR COALESCE(v_xml_mod = 'MP01', false)
               OR COALESCE(v_scontrino, false);

  -- (0) La fattura dice CONTANTI, o è emessa a fronte di uno scontrino: vince sul default
  -- del fornitore e sulla categoria, perché è il documento a dire come è andata.
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
