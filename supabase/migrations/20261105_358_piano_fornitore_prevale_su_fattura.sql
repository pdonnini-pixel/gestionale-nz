-- 358: il piano del fornitore puo' prevalere sui termini scritti in fattura.
--
-- Caso: Torino Fashion Village (05/11/2026). La fattura dichiara «MP05 bonifico,
-- scadenza alla data fattura», ma il fornitore incassa con SDD in tre terzi.
-- Il bridge A-Cube applica il piano del fornitore solo quando la fattura tace,
-- quindi ogni fattura nasceva con una scadenza unica sbagliata.
--
-- Cosa cambia:
--   * suppliers.plan_overrides_invoice (boolean, default false): spunta nella
--     scheda del fornitore. Spenta = comportamento di prima, per tutti.
--   * sync_acube_sdi_passive_to_payable: con la spunta accesa e il piano completo
--     (base, giorni, n. rate), le rate si calcolano dal piano anche se la fattura
--     porta le sue scadenze; il metodo e' quello dell'anagrafica.
--     Vale per le fatture dal 31/07/2026, come il piano. Note di credito escluse.
-- Additiva: nessun dato esistente cambia, nessuna scadenza viene ricalcolata.
-- Tenant: NZ e Zago (Made non riceve piu' modifiche al DB dal 03/11/2026).

BEGIN;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS plan_overrides_invoice boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.suppliers.plan_overrides_invoice IS
  'Se true, le scadenze delle fatture A-Cube seguono il piano del fornitore (payment_base, prima_scadenza_gg, numero_rate) anche quando la fattura dichiara i suoi termini.';

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
  v_prevale boolean := false;
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

  select payment_base, prima_scadenza_gg, numero_rate, payment_bank_account_id, default_payment_method::text,
         coalesce(plan_overrides_invoice, false)
    into v_pb, v_prima, v_nrate, v_bank, v_smethod, v_prevale
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

  -- 358: il piano del fornitore prevale sui termini scritti in fattura, solo se
  -- l'operatrice lo ha chiesto nella scheda del fornitore e il piano e' completo.
  -- Si azzera il conteggio delle rate lette, cosi' si entra nel ramo del piano;
  -- il metodo e' quello del fornitore, il codice MP della fattura resta come traccia.
  v_prevale := v_prevale and v_pb is not null and v_prima is not null and v_nrate is not null
               and NEW.invoice_date >= DATE '2026-07-31' and coalesce(NEW.total_amount,0) > 0;
  if v_prevale then
    n := 0;
    v_method := coalesce(v_smethod::public.payment_method, v_method);
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
        case when v_prevale
             then 'Piano del fornitore, prevale sui termini in fattura'
                  || case when v_mets[1] is not null or v_tp is not null
                          then ' (in fattura: ' || trim(coalesce(v_mets[1] || ' ' || coalesce(public.fn_sdi_mp_label(v_mets[1]), ''), '') || ' ' || coalesce(v_tp, '')) || ')'
                          else '' end
             else 'Auto-generata da piano fornitore (fattura senza termini di pagamento)' end
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


COMMIT;

-- VERIFICA (per tenant)
-- select column_name, data_type, column_default, is_nullable from information_schema.columns
--   where table_schema='public' and table_name='suppliers' and column_name='plan_overrides_invoice';
-- select count(*) filter (where plan_overrides_invoice) from public.suppliers;   -- 0
-- select md5(prosrc) from pg_proc where proname='sync_acube_sdi_passive_to_payable';  -- uguale su NZ e Zago
