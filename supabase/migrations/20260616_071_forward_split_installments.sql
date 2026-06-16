-- FORWARD: i due path di import creano le scadenze leggendo le rate reali
-- dall'XML FatturaPA (helper fn_parse_invoice_payments). Niente doppi:
--  - fn_invoice_to_payable (path electronic_invoices) salta le fatture A-Cube
--    (acube_uuid valorizzato), gestite da sync_acube_sdi_passive_to_payable.
--  - 1 rata -> due_date reale; N rate -> N payables (installment 1..N), ultima
--    rata assorbe l'arrotondamento; fallback a 1 scadenza (invoice_date+termini)
--    se non ci sono scadenze utili o Σ rate != gross (es. ritenuta) o nota credito.
-- Applicata live su NZ + Made + Zago.

create or replace function public.fn_invoice_to_payable()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_supplier_id uuid; v_terms int; v_due date; n int; sum_rate numeric; tol numeric; i int; v_dues date[]; v_amts numeric[]; v_mets text[];
begin
  if NEW.acube_uuid is not null then return NEW; end if;
  select id into v_supplier_id from suppliers where company_id = NEW.company_id
    and ((NEW.supplier_vat is not null and vat_number = NEW.supplier_vat) or (NEW.supplier_name is not null and name ilike NEW.supplier_name)) limit 1;
  select coalesce(payment_terms, default_payment_terms, 30) into v_terms from suppliers where id = v_supplier_id;
  v_terms := coalesce(v_terms, 30);
  select array_agg(due_date order by installment), array_agg(amount order by installment), array_agg(method order by installment), count(*), coalesce(sum(amount),0)
    into v_dues, v_amts, v_mets, n, sum_rate from public.fn_parse_invoice_payments(NEW.xml_content) where due_date is not null and amount is not null;
  if coalesce(NEW.gross_amount,0) <= 0 or n is null or n = 0 then
    v_due := coalesce(NEW.due_date, NEW.invoice_date + (v_terms||' days')::interval);
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, net_amount, vat_amount, gross_amount, amount_remaining, electronic_invoice_id, import_batch_id, payment_method_code, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_due, v_due, NEW.net_amount, NEW.vat_amount, NEW.gross_amount, NEW.gross_amount, NEW.id, NEW.import_batch_id, NEW.payment_method, 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
    return NEW;
  end if;
  tol := greatest(0.05, NEW.gross_amount*0.001);
  if abs(sum_rate - NEW.gross_amount) > tol then
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, net_amount, vat_amount, gross_amount, amount_remaining, electronic_invoice_id, import_batch_id, payment_method_code, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[1], v_dues[1], NEW.net_amount, NEW.vat_amount, NEW.gross_amount, NEW.gross_amount, NEW.id, NEW.import_batch_id, coalesce(v_mets[1], NEW.payment_method), 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
    return NEW;
  end if;
  if n = 1 then
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, net_amount, vat_amount, gross_amount, amount_remaining, electronic_invoice_id, import_batch_id, payment_method_code, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[1], v_dues[1], NEW.net_amount, NEW.vat_amount, NEW.gross_amount, NEW.gross_amount, NEW.id, NEW.import_batch_id, coalesce(v_mets[1], NEW.payment_method), 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
    return NEW;
  end if;
  v_amts[n] := round(NEW.gross_amount - (select coalesce(sum(a),0) from unnest(v_amts[1:n-1]) a), 2);
  for i in 1..n loop
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, gross_amount, amount_remaining, electronic_invoice_id, import_batch_id, installment_number, installment_total, payment_method_code, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[i], v_dues[i], v_amts[i], v_amts[i], NEW.id, NEW.import_batch_id, i, n, coalesce(v_mets[i], NEW.payment_method), 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
  end loop;
  return NEW;
end; $$;

create or replace function public.sync_acube_sdi_passive_to_payable()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_company_id uuid; v_supplier_id uuid; v_electronic_invoice_id uuid; v_default_terms integer := 30; v_due_date date; v_name text;
  n int; sum_rate numeric; tol numeric; i int; v_dues date[]; v_amts numeric[]; v_mets text[];
begin
  if NEW.direction <> 'passive' then return NEW; end if;
  select id into v_company_id from public.companies limit 1;
  if v_company_id is null then return NEW; end if;
  v_name := NEW.sender_name;
  if v_name is null or v_name ~ '^[0-9]+$' or v_name = NEW.sender_vat then
    v_name := public._acube_extract_cedente_name(coalesce(NEW.xml_content, NEW.payload::text), NEW.sender_vat);
  end if;
  select id into v_supplier_id from public.suppliers where company_id = v_company_id and (partita_iva = NEW.sender_vat or vat_number = NEW.sender_vat) limit 1;
  if v_supplier_id is null then
    insert into public.suppliers (id, company_id, name, ragione_sociale, vat_number, partita_iva, nazione, source, is_active, payment_terms, payment_method)
    values (gen_random_uuid(), v_company_id, v_name, v_name, NEW.sender_vat, NEW.sender_vat, coalesce(NEW.sender_country,'IT'), 'acube_sdi', true, v_default_terms, 'bonifico_ordinario')
    returning id into v_supplier_id;
  else
    select coalesce(payment_terms, default_payment_terms, 30) into v_default_terms from public.suppliers where id = v_supplier_id;
  end if;
  v_due_date := NEW.invoice_date + (v_default_terms || ' days')::interval;
  insert into public.electronic_invoices (id, company_id, invoice_number, invoice_date, supplier_name, supplier_vat, gross_amount, due_date, sdi_id, sdi_status, tipo_documento, source, xml_content, acube_uuid, codice_destinatario, created_at)
  values (gen_random_uuid(), v_company_id, NEW.invoice_number, NEW.invoice_date, v_name, NEW.sender_vat, NEW.total_amount, v_due_date, NEW.sdi_file_id, public._acube_marking_to_sdi_status(NEW.marking), NEW.document_type, 'api_acube_sdi', NEW.payload::text, NEW.acube_uuid, NEW.recipient_code, now())
  on conflict (acube_uuid) do nothing returning id into v_electronic_invoice_id;
  if v_electronic_invoice_id is null then select id into v_electronic_invoice_id from public.electronic_invoices where acube_uuid = NEW.acube_uuid; end if;
  select array_agg(due_date order by installment), array_agg(amount order by installment), array_agg(method order by installment), count(*), coalesce(sum(amount),0)
    into v_dues, v_amts, v_mets, n, sum_rate from public.fn_parse_invoice_payments(NEW.xml_content) where due_date is not null and amount is not null;
  tol := greatest(0.05, coalesce(NEW.total_amount,0)*0.001);
  if coalesce(NEW.total_amount,0) > 0 and n is not null and n >= 2 and abs(sum_rate - NEW.total_amount) <= tol then
    v_amts[n] := round(NEW.total_amount - (select coalesce(sum(a),0) from unnest(v_amts[1:n-1]) a), 2);
    insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, gross_amount, status, payment_method, payment_method_code, electronic_invoice_id, acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, created_at)
    values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[1], v_dues[1], v_amts[1], 'da_pagare'::payable_status, 'bonifico_ordinario'::payment_method, v_mets[1], v_electronic_invoice_id, NEW.acube_uuid, v_name, NEW.sender_vat, 1, n, now())
    on conflict (acube_uuid) do nothing;
    for i in 2..n loop
      insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, gross_amount, status, payment_method, payment_method_code, electronic_invoice_id, supplier_name, supplier_vat, installment_number, installment_total, created_at)
      values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[i], v_dues[i], v_amts[i], 'da_pagare'::payable_status, 'bonifico_ordinario'::payment_method, v_mets[i], v_electronic_invoice_id, v_name, NEW.sender_vat, i, n, now())
      on conflict do nothing;
    end loop;
  else
    insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, gross_amount, status, payment_method, payment_method_code, electronic_invoice_id, acube_uuid, supplier_name, supplier_vat, created_at)
    values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, coalesce(v_dues[1], v_due_date), coalesce(v_dues[1], v_due_date), NEW.total_amount, 'da_pagare'::payable_status, 'bonifico_ordinario'::payment_method, v_mets[1], v_electronic_invoice_id, NEW.acube_uuid, v_name, NEW.sender_vat, now())
    on conflict (acube_uuid) do nothing;
  end if;
  return NEW;
end; $$;
