-- ROLLBACK di 20260910_205 — riporta gli addebiti diretti a NON essere automatici:
-- fn_payable_auto_debit torna alla versione della migration 201 (dove l'addebito
-- diretto è solo una guardia contro la categoria, senza marcatura) e
-- fn_cash_card_provisional_close torna a coprire i soli contanti e carte.
-- Le scadenze già marcate non si smarcano da sole:
--   UPDATE public.payables SET is_auto_debit = false
--    WHERE payment_method::text IN ('rid','sdd_core','sdd_b2b')
--      AND status IN ('da_pagare','in_scadenza','scaduto','parziale');
-- e quelle già chiuse in via provvisoria si riaprono da UI con «Riapri».

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
          IN ('contanti', 'carta_credito', 'carta_debito')
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
    ELSE
      v_metodo := 'con carta di debito';
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
