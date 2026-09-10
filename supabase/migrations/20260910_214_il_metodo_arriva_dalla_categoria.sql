-- 20260910_214 — Quando la fattura non dice come si paga, lo dice la categoria
--
-- Seconda meta' della 213. Il profilo ora calcola la CATEGORIA per prima, perche' da lei
-- puo' dipendere il metodo, e sceglie con questa precedenza:
--   1. il codice MP dichiarato in fattura;
--   2. il metodo tipico della categoria (`cost_categories.default_payment_method`);
--   3. il bonifico, come ultima spiaggia esplicita e non come regola.
-- Il bridge, di conseguenza, non crea piu' il fornitore col bonifico d'ufficio: se la
-- fattura tace lascia il metodo vuoto e lo decide il profilo, chiamato subito dopo.
--
-- PROVA A SECCO su NZ (fornitore fittizio, fattura BELLUCO senza dati_pagamento, rollback
-- forzato): il fornitore nasce «carta di credito», categoria «mezzi e carburante», piano
-- immediato alla data fattura, e la scadenza esce come addebito automatico al 20/10.
-- Prima nasceva «bonifico» e finiva nel riquadro rosso.

CREATE OR REPLACE FUNCTION public.fn_supplier_profile_from_invoice(
  p_supplier_id uuid,
  p_company_id  uuid,
  p_doc         text,
  p_invoice_date date,
  p_invoice_id  uuid DEFAULT NULL
)
 RETURNS text[]
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  s        public.suppliers%ROWTYPE;
  v_prof   jsonb;
  v_json   jsonb;
  v_isxml  boolean;
  v_dues   date[];
  v_mets   text[];
  n        integer;
  v_first  date;
  v_gg     integer;
  v_months integer;
  v_base   text := NULL;
  v_prima  integer := NULL;
  v_nrate  integer := NULL;
  v_std    boolean := false;
  v_era_std boolean;
  v_senza_piano boolean;
  v_metodo text;
  v_cat    uuid := NULL;
  v_method public.payment_method := NULL;
  v_fields text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO s FROM public.suppliers WHERE id = p_supplier_id;
  IF NOT FOUND OR s.company_id <> p_company_id THEN RETURN v_fields; END IF;

  v_prof  := public.fn_invoice_cedente_profile(p_doc);
  v_isxml := left(btrim(coalesce(p_doc, ''), chr(65279) || E' \t\r\n'), 1) = '<';

  -- scadenze e modalita' dichiarate in fattura
  IF v_isxml THEN
    SELECT array_agg(due_date ORDER BY installment), count(*)
      INTO v_dues, n
      FROM public.fn_parse_invoice_payments(p_doc) WHERE due_date IS NOT NULL;
    SELECT array_agg(method ORDER BY installment) INTO v_mets
      FROM public.fn_parse_invoice_payments(p_doc) WHERE method IS NOT NULL;
  ELSE
    BEGIN v_json := btrim(coalesce(p_doc, ''), chr(65279) || E' \t\r\n')::jsonb;
    EXCEPTION WHEN others THEN v_json := NULL; END;
    SELECT array_agg(due_date ORDER BY installment), count(*)
      INTO v_dues, n
      FROM public.fn_parse_invoice_payments_json(v_json) WHERE due_date IS NOT NULL;
    SELECT array_agg(method ORDER BY installment) INTO v_mets
      FROM public.fn_parse_invoice_payments_json(v_json) WHERE method IS NOT NULL;
  END IF;

  -- (a) PIANO DI PAGAMENTO: solo se il fornitore non ne ha ancora uno, e solo da
  --     scadenze coerenti (non anteriori alla fattura, non oltre l'anno).
  -- La CATEGORIA si calcola per prima: da lei puo' dipendere il metodo di pagamento.
  IF s.default_cost_category_id IS NULL THEN
    v_cat := public.fn_categorize_from_lines(p_company_id, p_doc);
  END IF;

  -- METODO: 1) codice MP dichiarato in fattura, 2) metodo tipico della categoria,
  --         3) bonifico come ultima spiaggia. Mai sopra una scelta gia' fatta.
  IF s.default_payment_method IS NULL THEN
    IF coalesce(v_mets[1], '') <> '' THEN
      v_method := public.fn_sdi_mp_to_payment_method(v_mets[1], NULL);
    ELSE
      SELECT c.default_payment_method INTO v_method
        FROM public.cost_categories c
       WHERE c.id = coalesce(s.default_cost_category_id, v_cat);
      IF v_method IS NULL THEN
        v_method := 'bonifico_ordinario'::public.payment_method;
      END IF;
    END IF;
  END IF;

  -- senza piano = senza BASE: e' quella che rende il piano calcolabile
  v_senza_piano := s.payment_base IS NULL;
  v_era_std     := coalesce(s.profile_from_invoice_fields, ARRAY[]::text[]) @> ARRAY['piano_standard'];

  IF (v_senza_piano OR v_era_std) AND coalesce(n, 0) >= 1 AND p_invoice_date IS NOT NULL THEN
    v_first := v_dues[1];
    IF v_first IS NOT NULL AND v_first >= p_invoice_date AND v_first <= p_invoice_date + 400 THEN
      v_gg     := v_first - p_invoice_date;
      v_months := (extract(year FROM v_first)::int * 12 + extract(month FROM v_first)::int)
                - (extract(year FROM p_invoice_date)::int * 12 + extract(month FROM p_invoice_date)::int);
      IF v_first = (date_trunc('month', v_first) + interval '1 month' - interval '1 day')::date
         AND v_months BETWEEN 0 AND 12 THEN
        v_base  := 'fine_mese';
        v_prima := v_months * 30;
      ELSE
        v_base  := 'data_fattura';
        v_prima := v_gg;
      END IF;
      v_nrate := greatest(n, 1);
    END IF;
  END IF;

  -- (b) METODO: solo se manca del tutto (mai sopra una scelta fatta a mano).
  IF v_base IS NULL AND v_senza_piano THEN
    v_metodo := coalesce(s.default_payment_method::text, v_method::text, s.payment_method, '');
    IF v_metodo IN ('contanti', 'carta_credito', 'carta_debito') THEN
      v_base := 'data_fattura'; v_prima := coalesce(s.prima_scadenza_gg, 0);
    ELSE
      v_base := 'fine_mese'; v_prima := coalesce(s.prima_scadenza_gg, 30);
    END IF;
    v_nrate := coalesce(s.numero_rate, 1);
    v_std := true;
  END IF;


  -- quali campi sta compilando davvero questa chiamata
  IF s.codice_fiscale IS NULL AND v_prof ? 'codice_fiscale' THEN v_fields := array_append(v_fields, 'codice_fiscale'); END IF;
  IF s.regime_fiscale IS NULL AND v_prof ? 'regime_fiscale' THEN v_fields := array_append(v_fields, 'regime_fiscale'); END IF;
  IF s.indirizzo      IS NULL AND v_prof ? 'indirizzo'      THEN v_fields := array_append(v_fields, 'indirizzo'); END IF;
  IF s.cap            IS NULL AND v_prof ? 'cap'            THEN v_fields := array_append(v_fields, 'cap'); END IF;
  IF s.citta          IS NULL AND v_prof ? 'comune'         THEN v_fields := array_append(v_fields, 'citta'); END IF;
  IF s.provincia      IS NULL AND v_prof ? 'provincia'      THEN v_fields := array_append(v_fields, 'provincia'); END IF;
  IF nullif(s.iban, '') IS NULL AND v_prof ? 'iban'         THEN v_fields := array_append(v_fields, 'iban'); END IF;
  IF v_base   IS NOT NULL THEN
    v_fields := array_append(v_fields, CASE WHEN v_std THEN 'piano_standard' ELSE 'piano_pagamento' END);
  END IF;
  IF v_method IS NOT NULL THEN v_fields := array_append(v_fields, 'metodo_pagamento'); END IF;
  IF v_cat    IS NOT NULL THEN v_fields := array_append(v_fields, 'categoria'); END IF;

  IF array_length(v_fields, 1) IS NULL THEN RETURN v_fields; END IF;

  UPDATE public.suppliers SET
    codice_fiscale = coalesce(codice_fiscale, v_prof->>'codice_fiscale'),
    fiscal_code    = coalesce(fiscal_code,    v_prof->>'codice_fiscale'),
    regime_fiscale = coalesce(regime_fiscale, v_prof->>'regime_fiscale'),
    indirizzo      = coalesce(indirizzo,      v_prof->>'indirizzo'),
    cap            = coalesce(cap,            v_prof->>'cap'),
    citta          = coalesce(citta,          v_prof->>'comune'),
    comune         = coalesce(comune,         v_prof->>'comune'),
    provincia      = coalesce(provincia,      v_prof->>'provincia'),
    nazione        = coalesce(nazione,        v_prof->>'nazione'),
    paese          = coalesce(paese,          v_prof->>'nazione'),
    iban           = coalesce(nullif(iban, ''), v_prof->>'iban'),
    payment_base       = CASE WHEN v_base IS NOT NULL THEN v_base ELSE payment_base END,
    prima_scadenza_gg  = CASE WHEN v_base IS NOT NULL THEN v_prima ELSE prima_scadenza_gg END,
    numero_rate        = CASE WHEN v_base IS NOT NULL THEN v_nrate ELSE numero_rate END,
    default_payment_method = coalesce(default_payment_method, v_method),
    payment_method         = CASE WHEN default_payment_method IS NULL AND v_method IS NOT NULL
                                  THEN v_method::text ELSE payment_method END,
    default_cost_category_id = coalesce(default_cost_category_id, v_cat),
    profile_from_invoice_id     = coalesce(p_invoice_id, profile_from_invoice_id),
    profile_from_invoice_at     = now(),
    profile_from_invoice_fields = (
      SELECT array_agg(DISTINCT f)
        FROM unnest(
          CASE WHEN v_base IS NOT NULL AND NOT v_std
               THEN array_remove(coalesce(profile_from_invoice_fields, ARRAY[]::text[]), 'piano_standard')
               ELSE coalesce(profile_from_invoice_fields, ARRAY[]::text[]) END
          || v_fields) f
    ),
    updated_at = now()
  WHERE id = p_supplier_id;

  RETURN v_fields;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_acube_sdi_passive_to_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
declare
  v_company_id uuid; v_supplier_id uuid; v_electronic_invoice_id uuid; v_name text;
  n int; sum_rate numeric; tol numeric; i int; v_dues date[]; v_amts numeric[]; v_mets text[];
  v_net numeric; v_vat numeric; v_realxml text; v_xml text; v_due_fallback date;
  v_pb text; v_prima int; v_nrate int; v_bank uuid; v_smethod text; rec record;
  v_is_nc boolean;
  v_tp text;
  v_method public.payment_method;
  v_new_method public.payment_method;
  v_note text;
  v_payload jsonb; v_wh numeric := 0; v_net_due numeric;
  v_whs numeric[]; v_wh_acc numeric := 0; v_row_wh numeric;
begin
  if NEW.direction <> 'passive' then return NEW; end if;
  select id into v_company_id from public.companies
   where NEW.recipient_vat is not null
     and regexp_replace(coalesce(vat_number,''),'\D','','g') = regexp_replace(NEW.recipient_vat,'\D','','g')
   limit 1;
  if v_company_id is null and (select count(*) from public.companies) = 1 then
    select id into v_company_id from public.companies limit 1;
  end if;
  if v_company_id is null then
    raise warning '[sync_acube_sdi_passive] company non risolta (recipient_vat=%, acube_uuid=%)', NEW.recipient_vat, NEW.acube_uuid;
    return NEW;
  end if;
  v_realxml := ltrim(NEW.xml_content, chr(65279) || E' \t\r\n');
  if v_realxml is null or left(v_realxml,1) <> '<' then v_realxml := null; end if;
  v_name := NEW.sender_name;
  if v_name is null or v_name ~ '^[0-9]+$' or v_name = NEW.sender_vat then
    v_name := public._acube_extract_cedente_name(v_realxml, NULL);
  end if;
  if v_name is null or v_name ~ '^[0-9]+$' or v_name = NEW.sender_vat then
    v_name := public._acube_cedente_name_json(NEW.payload, NEW.sender_vat);
  end if;
  select coalesce(sum((r->>'imponibile_importo')::numeric), 0), coalesce(sum((r->>'imposta')::numeric), 0)
    into v_net, v_vat
  from jsonb_array_elements(coalesce(NEW.payload->'fattura_elettronica_body', '[]'::jsonb)) body
  cross join lateral jsonb_array_elements(coalesce(body #> '{dati_beni_servizi,dati_riepilogo}', '[]'::jsonb)) r;
  if coalesce(v_net,0) = 0 and coalesce(v_vat,0) = 0 and coalesce(NEW.total_amount,0) <> 0 then
    v_net := NEW.total_amount; v_vat := 0;
  end if;
  v_xml := coalesce(v_realxml, NEW.payload::text);

  v_payload := case when jsonb_typeof(NEW.payload) = 'object' then NEW.payload else null end;
  v_wh := coalesce(public.fn_invoice_withholding(v_realxml, v_payload), 0);
  if coalesce(NEW.total_amount,0) > 0 then
    v_wh := least(greatest(v_wh, 0), NEW.total_amount);
  else
    v_wh := 0;
  end if;
  v_net_due := round(coalesce(NEW.total_amount,0) - v_wh, 2);

  select array_agg(due_date order by installment), array_agg(amount order by installment),
         array_agg(method order by installment), count(*), coalesce(sum(amount),0)
    into v_dues, v_amts, v_mets, n, sum_rate
  from public.fn_parse_invoice_payments(v_realxml) where due_date is not null and amount is not null;
  v_tp := public.fn_parse_invoice_condizioni(v_realxml);
  if coalesce(n,0) = 0 then
    select array_agg(due_date order by installment), array_agg(amount order by installment),
           array_agg(method order by installment), count(*), coalesce(sum(amount),0)
      into v_dues, v_amts, v_mets, n, sum_rate
    from public.fn_parse_invoice_payments_json(NEW.payload) where due_date is not null and amount is not null;
  end if;
  if v_tp is null then v_tp := public.fn_parse_invoice_condizioni_json(NEW.payload); end if;
  if v_mets is null or v_mets[1] is null then
    select array_agg(method order by installment) into v_mets
    from public.fn_parse_invoice_payments(v_realxml) where method is not null;
    if v_mets is null then
      select array_agg(method order by installment) into v_mets
      from public.fn_parse_invoice_payments_json(NEW.payload) where method is not null;
    end if;
  end if;
  v_due_fallback := NEW.invoice_date;

  -- la fattura prima del fornitore: serve il suo id per tracciare il profilo
  insert into public.electronic_invoices (id, company_id, invoice_number, invoice_date, supplier_name, supplier_vat,
    net_amount, vat_amount, gross_amount, withholding_amount, due_date, sdi_id, sdi_status, tipo_documento, source, xml_content, acube_uuid, codice_destinatario,
    payment_method, payment_terms, created_at)
  values (gen_random_uuid(), v_company_id, NEW.invoice_number, NEW.invoice_date, v_name, NEW.sender_vat,
    v_net, v_vat, NEW.total_amount, v_wh, coalesce(v_dues[1], v_due_fallback), NEW.sdi_file_id, public._acube_marking_to_sdi_status(NEW.marking), NEW.document_type, 'api_acube_sdi',
    v_xml, NEW.acube_uuid, NEW.recipient_code,
    v_mets[1], v_tp, now())
  on conflict (acube_uuid) do nothing returning id into v_electronic_invoice_id;
  if v_electronic_invoice_id is null then
    select id into v_electronic_invoice_id from public.electronic_invoices where acube_uuid = NEW.acube_uuid;
  end if;

  select id into v_supplier_id from public.suppliers
  where company_id = v_company_id and (partita_iva = NEW.sender_vat or vat_number = NEW.sender_vat) limit 1;
  if v_supplier_id is null then
    -- solo il metodo DICHIARATO in fattura; se tace si lascia vuoto e decide il profilo
    -- (categoria, poi bonifico come ultima spiaggia). Niente bonifico d'ufficio.
    v_new_method := case when coalesce(v_mets[1], '') <> ''
                         then public.fn_sdi_mp_to_payment_method(v_mets[1], null) end;
    insert into public.suppliers (id, company_id, name, ragione_sociale, vat_number, partita_iva, nazione, source, is_active, payment_terms, payment_method, default_payment_method)
    values (gen_random_uuid(), v_company_id, v_name, v_name, NEW.sender_vat, NEW.sender_vat, coalesce(NEW.sender_country,'IT'), 'acube_sdi', true, 30,
            v_new_method::text, v_new_method)
    returning id into v_supplier_id;
  end if;

  perform public.fn_supplier_profile_from_invoice(
    v_supplier_id, v_company_id, v_xml, NEW.invoice_date, v_electronic_invoice_id);

  select payment_base, prima_scadenza_gg, numero_rate, payment_bank_account_id, default_payment_method::text
    into v_pb, v_prima, v_nrate, v_bank, v_smethod
  from public.suppliers where id = v_supplier_id;

  v_method := public.fn_sdi_mp_to_payment_method(v_mets[1], v_smethod);

  if upper(coalesce(NEW.document_type, '')) in ('TD16','TD17','TD18','TD19') then
    return NEW;
  end if;

  v_is_nc := upper(coalesce(NEW.document_type, '')) in ('TD04', 'TD08');
  if v_is_nc then
    insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
      gross_amount, status, payment_method, payment_method_code, electronic_invoice_id, acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, created_at)
    values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date,
      coalesce(v_dues[1], v_due_fallback), coalesce(v_dues[1], v_due_fallback),
      -abs(NEW.total_amount), 'nota_credito'::payable_status, 'bonifico_ordinario'::payment_method, coalesce(v_mets[1], null),
      v_electronic_invoice_id, NEW.acube_uuid, v_name, NEW.sender_vat, 1, 1, now())
    on conflict do nothing;
    return NEW;
  end if;

  v_note := 'Termini letti dalla fattura'
            || case when v_mets[1] is not null then ' (' || v_mets[1] || coalesce(' ' || public.fn_sdi_mp_label(v_mets[1]), '') || ')' else '' end
            || case when v_tp is not null then ' ' || v_tp else '' end
            || case when v_wh > 0 then ' | ritenuta d''acconto ' || trim(to_char(v_wh, 'FM999999990.00')) || ' dedotta dal totale ' || trim(to_char(coalesce(NEW.total_amount,0), 'FM999999990.00')) else '' end;
  tol := greatest(0.05, coalesce(NEW.total_amount,0)*0.001);

  if coalesce(NEW.total_amount,0) > 0 and n is not null and n >= 2
     and ( abs(sum_rate - v_net_due) <= tol
           or (v_wh > 0 and abs(sum_rate - NEW.total_amount) <= tol) ) then
    if v_wh > 0 and abs(sum_rate - v_net_due) > tol then
      for i in 1..n loop v_amts[i] := round(v_amts[i] * v_net_due / NEW.total_amount, 2); end loop;
    end if;
    v_amts[n] := round(v_net_due - (select coalesce(sum(a),0) from unnest(v_amts[1:n-1]) a), 2);
    for i in 1..n loop
      v_whs[i] := case when v_wh > 0 and v_net_due <> 0 then round(v_wh * v_amts[i] / v_net_due, 2) else 0 end;
    end loop;
    if v_wh > 0 then
      v_whs[n] := round(v_wh - (select coalesce(sum(w),0) from unnest(v_whs[1:n-1]) w), 2);
    end if;
    for i in 1..n loop
      insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
        gross_amount, withholding_amount, status, payment_method, payment_method_code, payment_method_label, payment_bank_account_id, electronic_invoice_id,
        acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, notes, created_at)
      values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[i], v_dues[i],
        v_amts[i], coalesce(v_whs[i],0), 'da_pagare'::payable_status,
        public.fn_sdi_mp_to_payment_method(coalesce(v_mets[i], v_mets[1]), v_smethod), coalesce(v_mets[i], v_mets[1]),
        public.fn_sdi_mp_label(coalesce(v_mets[i], v_mets[1])), v_bank, v_electronic_invoice_id,
        case when i = 1 then NEW.acube_uuid else null end, v_name, NEW.sender_vat, i, n, v_note, now())
      on conflict do nothing;
    end loop;

  elsif coalesce(n,0) >= 1 then
    insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
      gross_amount, withholding_amount, status, payment_method, payment_method_code, payment_method_label, payment_bank_account_id, electronic_invoice_id,
      acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, notes, created_at)
    values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[1], v_dues[1],
      v_net_due, v_wh, 'da_pagare'::payable_status,
      v_method, v_mets[1], public.fn_sdi_mp_label(v_mets[1]), v_bank, v_electronic_invoice_id,
      NEW.acube_uuid, v_name, NEW.sender_vat, 1, 1, v_note, now())
    on conflict do nothing;

  elsif NEW.invoice_date >= DATE '2026-07-31'
        and v_pb is not null and v_nrate is not null and coalesce(NEW.total_amount,0) <> 0 then
    v_wh_acc := 0;
    for rec in
      select rata, due_date, importo
      from public.fn_supplier_installment_schedule(NEW.invoice_date, v_pb, v_prima, v_nrate, v_net_due)
    loop
      if v_wh <= 0 then
        v_row_wh := 0;
      elsif rec.rata = v_nrate then
        v_row_wh := round(v_wh - v_wh_acc, 2);
      else
        v_row_wh := case when v_net_due <> 0 then round(v_wh * rec.importo / v_net_due, 2) else 0 end;
        v_wh_acc := v_wh_acc + v_row_wh;
      end if;
      insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
        gross_amount, withholding_amount, status, payment_method, payment_method_code, payment_method_label, payment_bank_account_id, electronic_invoice_id,
        acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, notes, created_at)
      values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, rec.due_date, rec.due_date,
        rec.importo, v_row_wh, 'da_pagare'::payable_status,
        v_method, v_mets[1], public.fn_sdi_mp_label(v_mets[1]), v_bank, v_electronic_invoice_id,
        case when rec.rata = 1 then NEW.acube_uuid else null end, v_name, NEW.sender_vat, rec.rata, v_nrate,
        'Auto-generata da piano fornitore (fattura senza termini di pagamento)'
          || case when v_wh > 0 then ' | ritenuta d''acconto ' || trim(to_char(v_wh, 'FM999999990.00')) || ' dedotta dal totale' else '' end, now())
      on conflict do nothing;
    end loop;

  else
    insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
      gross_amount, withholding_amount, status, payment_method, payment_method_code, payment_method_label, payment_bank_account_id, electronic_invoice_id,
      acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, created_at)
    values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date,
      v_due_fallback, v_due_fallback,
      v_net_due, v_wh, 'da_pagare'::payable_status, v_method, v_mets[1], public.fn_sdi_mp_label(v_mets[1]), v_bank,
      v_electronic_invoice_id, NEW.acube_uuid, v_name, NEW.sender_vat, 1, 1, now())
    on conflict do nothing;
  end if;
  return NEW;
end; $function$;
