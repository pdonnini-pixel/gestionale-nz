-- 20260910_205 — Anche l'addebito diretto è un pagamento automatico.
--
-- PERCHÉ (Patrizio, 10/09/2026, guardando la fattura Lignano Banda Larga n. 1915:
-- «perché vedo questo SEPA?!»). La fattura dichiara SEPA Direct Debit B2B con scadenza
-- 15/09: quei 244,00 € partono dal conto da soli, per mandato. Eppure la scadenza stava
-- fra le Aperte, come se fosse un bonifico da disporre a mano.
--
-- È lo stesso problema già risolto per contanti e carte, su una domanda che Patrizio
-- aveva già fatto («e anche gli sdd?») e a cui non era stato dato seguito: contanti e
-- carte erano stati sistemati, gli addebiti diretti no. Su NZ restavano aperte 5
-- scadenze per 1.545,67 €, nessuna marcata come automatica.
--
-- SECONDO ERRORE CORRETTO QUI. La migration 201 elencava «MP17, MP19, MP20 (RIBA)».
-- Sbagliato: nei codici SDI MP20 è SEPA Direct Debit CORE e la RiBa è MP12. Mancavano
-- inoltre MP09, MP10, MP11 (RID) e MP21 (SDD B2B), che è proprio il codice della fattura
-- Lignano. Qui la lista è completa e verificata sui codici veri:
--   MP09 RID · MP10 RID utenze · MP11 RID veloce · MP16 domiciliazione bancaria
--   MP17 domiciliazione postale · MP19 SEPA Direct Debit · MP20 SDD CORE · MP21 SDD B2B
-- (MP12, la RiBa, resta fuori: ha il suo meccanismo dalla migration 146.)
--
-- COSA FA
--   1. fn_payable_auto_debit — riconosce l'addebito diretto dal codice dichiarato in
--      fattura (colonna o XML, nei due formati) e lo marca is_auto_debit, così esce dalla
--      lista dei bonifici da disporre e dal totale da pagare. NON tocca la scadenza: un
--      SDD esce alla sua data, non il 20 del mese dopo come la carta. Se la colonna dice
--      ancora «bonifico» mentre la fattura dichiara un addebito diretto, la colonna viene
--      allineata (R18: la fattura è la fonte, la colonna è una copia).
--   2. fn_cash_card_provisional_close — chiude in via provvisoria anche gli addebiti
--      diretti, alla loro data di scadenza, con la stessa reversibilità di carte e RiBa:
--      quando il movimento arriva davvero, l'aggancio rende la chiusura definitiva.
--   3. Backfill delle scadenze aperte già a sistema: solo la marcatura, nessuna chiusura.
--
-- Nessun dato cancellato. Rollback in _ROLLBACK.sql

-- ── 1. il trigger riconosce e marca l'addebito diretto ───────────────────────
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
  v_sdd_code  text := NULL;
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
      COALESCE(e.xml_content ~* '("causale":\s*\[[^\]]{0,250}(scontrino|ricevuta fiscale)|<Causale>[^<]{0,250}(scontrino|ricevuta fiscale))', false),
      -- Codice di addebito diretto dichiarato in fattura, nei due formati.
      (regexp_match(e.xml_content,
        '(?:<ModalitaPagamento>|"modalita_pagamento":\s*")(MP09|MP10|MP11|MP16|MP17|MP19|MP20|MP21)'))[1]
    INTO v_xml_mod, v_scontrino, v_sdd_code
    FROM public.electronic_invoices e
    WHERE e.id = NEW.electronic_invoice_id;
  END IF;

  v_is_mp08 := COALESCE(NEW.payment_method_code = 'MP08', false) OR COALESCE(v_xml_mod = 'MP08', false);
  v_is_mp01 := COALESCE(NEW.payment_method_code = 'MP01', false) OR COALESCE(v_xml_mod = 'MP01', false)
               OR COALESCE(v_scontrino, false);

  -- Addebito diretto: dal codice in colonna, da quello letto in fattura, o dalla
  -- colonna del metodo. La RiBa (MP12) resta fuori: ha il suo meccanismo.
  v_gia_sdd := COALESCE(NEW.payment_method_code IN
                          ('MP09','MP10','MP11','MP16','MP17','MP19','MP20','MP21'), false)
               OR (v_sdd_code IS NOT NULL)
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

  -- Un addebito diretto parte dal conto da solo, alla SUA data: si marca come
  -- automatico e non si tocca la scadenza. La RiBa ha il suo meccanismo, quindi
  -- qui si marcano solo rid e SDD.
  IF v_gia_sdd AND NOT v_is_mp08
     AND COALESCE(NEW.payment_method::text, '') NOT LIKE 'riba\_%'
     AND COALESCE(NEW.is_forecast, false) = false
     AND COALESCE(NEW.gross_amount, 0) > 0
     AND COALESCE(NEW.amount_paid, 0) = 0
     AND COALESCE(NEW.status::text, 'da_pagare') NOT IN ('annullato','nota_credito','pagato','parziale','sospeso','bloccato')
  THEN
    -- La fattura è la fonte, la colonna è una copia (R18): se il documento dichiara un
    -- addebito diretto e la colonna è rimasta sul bonifico d'ufficio, si allinea.
    IF v_sdd_code IS NOT NULL AND NEW.payment_method_code IS NULL THEN
      NEW.payment_method_code := v_sdd_code;
    END IF;
    IF COALESCE(NEW.payment_method::text, '') IN ('', 'bonifico_ordinario', 'bonifico_sepa', 'altro') THEN
      NEW.payment_method := CASE COALESCE(v_sdd_code, NEW.payment_method_code)
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

-- ── 2. la chiusura provvisoria copre anche gli addebiti diretti ──────────────
CREATE OR REPLACE FUNCTION public.fn_cash_card_provisional_close(
  p_company_id uuid DEFAULT NULL::uuid,
  p_include_backlog boolean DEFAULT false
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_activation CONSTANT date := DATE '2026-09-09';
  v_count integer := 0;
  v_metodo text;
  v_data date;
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.id, p.gross_amount, p.due_date, p.invoice_date, p.status,
           COALESCE(p.payment_method::text, s.payment_method::text, s.default_payment_method::text) AS metodo
    FROM public.payables p
    LEFT JOIN public.suppliers s ON s.id = p.supplier_id
    WHERE (p_company_id IS NULL OR p.company_id = p_company_id)
      AND COALESCE(p.payment_method::text, s.payment_method::text, s.default_payment_method::text)
          IN ('contanti', 'carta_credito', 'carta_debito', 'rid', 'sdd_core', 'sdd_b2b')
      AND p.gross_amount > 0
      AND COALESCE(p.is_placeholder, false) = false
      AND COALESCE(p.is_provisional_paid, false) = false
      AND COALESCE(p.closed_manually, false) = false
      AND p.bank_transaction_id IS NULL
      AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto')
      AND (
        CASE
          WHEN COALESCE(p.payment_method::text, s.payment_method::text, s.default_payment_method::text) = 'contanti'
            THEN p_include_backlog OR COALESCE(p.invoice_date, p.due_date) >= v_activation
          ELSE p.due_date <= CURRENT_DATE
               AND (p_include_backlog OR p.due_date >= v_activation)
        END
      )
  LOOP
    IF r.metodo = 'contanti' THEN
      v_metodo := 'in contanti';
      v_data := COALESCE(r.invoice_date, r.due_date);
    ELSIF r.metodo = 'carta_credito' THEN
      v_metodo := 'con carta di credito';
      v_data := r.due_date;
    ELSIF r.metodo = 'carta_debito' THEN
      v_metodo := 'con carta di debito';
      v_data := r.due_date;
    ELSE
      v_metodo := 'con addebito diretto (SDD/RID)';
      v_data := r.due_date;
    END IF;

    UPDATE public.payables
    SET amount_paid = gross_amount,
        payment_date = v_data,
        is_provisional_paid = true,
        provisional_paid_at = now()
    WHERE id = r.id;

    INSERT INTO public.payable_actions
      (payable_id, action_type, old_status, new_status, amount, note, performed_at)
    VALUES
      (r.id, 'chiusura_provvisoria_cassa_carte', r.status, 'pagato'::payable_status, r.gross_amount,
       'Chiusura provvisoria (pagamento ' || v_metodo || ') con data '
         || to_char(v_data, 'DD/MM/YYYY')
         || CASE WHEN r.metodo = 'contanti'
                 THEN ' (data della fattura: in contanti si paga alla consegna)'
                 WHEN r.metodo IN ('rid','sdd_core','sdd_b2b')
                 THEN ' (data dell''addebito autorizzato per mandato)'
                 ELSE ' (data di addebito della carta)' END
         || ' — in attesa del movimento, da A-Cube o da estratto conto caricato', now());

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_cash_card_provisional_close(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_cash_card_provisional_close(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_cash_card_provisional_close(uuid, boolean) TO authenticated, service_role;

-- ── 3. le scadenze già a sistema: solo la marcatura, nessuna chiusura ────────
UPDATE public.payables p
   SET is_auto_debit = true, updated_at = now()
 WHERE p.status IN ('da_pagare','in_scadenza','scaduto','parziale')
   AND COALESCE(p.is_provisional_paid,false) = false
   AND COALESCE(p.is_auto_debit,false) = false
   AND p.payment_method::text IN ('rid','sdd_core','sdd_b2b');
