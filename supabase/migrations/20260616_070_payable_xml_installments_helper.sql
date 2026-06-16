-- Scadenze fatture: leggere le rate reali (DatiPagamento/DettaglioPagamento)
-- dall'XML FatturaPA invece di usare 1 sola scadenza a invoice_date+30gg.
--
-- Questo file:
--  1) Helper di parsing namespace-agnostico (local-name) condiviso dai trigger.
--  2) Estende la chiave unica di payables per includere installment_number,
--     così una fattura può avere più rate con lo stesso numero.
--  3) Funzione di BACKFILL idempotente (eseguita una volta per tenant a mano,
--     con backup in-DB prima): corregge le date e splitta le rate sui dati
--     esistenti. Esclude note di credito e gli scostamenti (Σ rate ≠ gross,
--     es. ritenuta); per le lavorate la rata 1 eredita pagamento/link.
-- Applicata live su NZ (backfill eseguito) + Made + Zago (vuoti, solo schema).

create or replace function public.fn_parse_invoice_payments(p_xml text)
returns table(installment int, due_date date, amount numeric, method text)
language plpgsql immutable as $$
declare v_xml xml; v_nodes xml[]; v_node xml; i int := 0; v_due text; v_amt text; v_met text;
begin
  begin v_xml := p_xml::xml; exception when others then return; end;
  begin v_nodes := xpath('//*[local-name()="DatiPagamento"]/*[local-name()="DettaglioPagamento"]', v_xml); exception when others then return; end;
  if array_length(v_nodes,1) is null then return; end if;
  foreach v_node in array v_nodes loop
    i := i + 1;
    v_due := (xpath('.//*[local-name()="DataScadenzaPagamento"]/text()', v_node))[1]::text;
    v_amt := (xpath('.//*[local-name()="ImportoPagamento"]/text()', v_node))[1]::text;
    v_met := (xpath('.//*[local-name()="ModalitaPagamento"]/text()', v_node))[1]::text;
    installment := i;
    begin due_date := nullif(trim(v_due),'')::date; exception when others then due_date := null; end;
    begin amount := nullif(trim(v_amt),'')::numeric; exception when others then amount := null; end;
    method := nullif(trim(v_met),''); return next;
  end loop; return;
end; $$;

alter table public.payables drop constraint if exists payables_company_id_supplier_id_invoice_number_key;
create unique index if not exists payables_company_supplier_invoice_installment_key
  on public.payables (company_id, supplier_id, invoice_number, (coalesce(installment_number,0)));

create or replace function public.fn_backfill_payable_installments(p_company uuid)
returns jsonb language plpgsql as $$
declare
  r record; n int; sum_rate numeric; tol numeric; i int;
  v_dues date[]; v_amts numeric[]; v_mets text[];
  c_date int:=0; c_split int:=0; c_newrows int:=0; c_skip_inv int:=0; c_skip_paid int:=0; c_already int:=0;
  flagged jsonb := '[]'::jsonb;
begin
  for r in
    select p.id, p.company_id, p.outlet_id, p.supplier_id, p.supplier_name, p.supplier_vat,
           p.invoice_number, p.invoice_date, p.due_date, p.gross_amount, p.amount_paid, p.status::text st,
           p.cost_category_id, p.payment_method, p.payment_method_code, p.electronic_invoice_id,
           p.import_batch_id, p.notes, e.xml_content
    from public.payables p
    join public.electronic_invoices e on e.id = p.electronic_invoice_id
    where p.company_id = p_company and coalesce(p.installment_number,0) = 0
      and e.xml_content is not null and e.xml_content like '%DataScadenzaPagamento%'
  loop
    if r.gross_amount <= 0 or r.st in ('nota_credito','annullato') then continue; end if;
    select array_agg(due_date order by installment), array_agg(amount order by installment),
           array_agg(method order by installment), count(*), coalesce(sum(amount),0)
      into v_dues, v_amts, v_mets, n, sum_rate
    from public.fn_parse_invoice_payments(r.xml_content)
    where due_date is not null and amount is not null;
    if n is null or n = 0 then continue; end if;
    tol := greatest(0.05, r.gross_amount * 0.001);
    if abs(sum_rate - r.gross_amount) > tol then
      c_skip_inv := c_skip_inv + 1;
      flagged := flagged || jsonb_build_object('invoice', r.invoice_number, 'reason','invariant','gross',r.gross_amount,'sum_rate',sum_rate);
      continue;
    end if;
    if exists(select 1 from public.payables x where x.company_id=r.company_id and x.invoice_number=r.invoice_number
              and coalesce(x.installment_number,0) >= 1
              and (x.supplier_id is not distinct from r.supplier_id or x.supplier_name is not distinct from r.supplier_name)) then
      c_already := c_already + 1; continue;
    end if;
    if n = 1 then
      if v_dues[1] is distinct from r.due_date then
        update public.payables set due_date=v_dues[1], original_due_date=v_dues[1],
          payment_method_code=coalesce(v_mets[1], payment_method_code), updated_at=now() where id=r.id;
        c_date := c_date + 1;
      end if;
    else
      if coalesce(r.amount_paid,0) > v_amts[1] + tol then
        c_skip_paid := c_skip_paid + 1;
        flagged := flagged || jsonb_build_object('invoice', r.invoice_number, 'reason','paid_spans','amount_paid',r.amount_paid,'rata1',v_amts[1]);
        continue;
      end if;
      v_amts[n] := round(r.gross_amount - (select coalesce(sum(a),0) from unnest(v_amts[1:n-1]) a), 2);
      update public.payables set due_date=v_dues[1], original_due_date=v_dues[1], gross_amount=v_amts[1],
        net_amount=null, vat_amount=null, installment_number=1, installment_total=n,
        payment_method_code=coalesce(v_mets[1], payment_method_code), updated_at=now() where id=r.id;
      c_split := c_split + 1;
      for i in 2..n loop
        insert into public.payables (company_id, outlet_id, supplier_id, supplier_name, supplier_vat,
          invoice_number, invoice_date, due_date, original_due_date, gross_amount, amount_paid,
          cost_category_id, payment_method, payment_method_code, electronic_invoice_id, import_batch_id,
          installment_number, installment_total, status, notes, created_at, updated_at)
        values (r.company_id, r.outlet_id, r.supplier_id, r.supplier_name, r.supplier_vat,
          r.invoice_number, r.invoice_date, v_dues[i], v_dues[i], v_amts[i], 0,
          r.cost_category_id, r.payment_method, coalesce(v_mets[i], r.payment_method_code), r.electronic_invoice_id, r.import_batch_id,
          i, n, 'da_pagare'::payable_status, r.notes, now(), now());
        c_newrows := c_newrows + 1;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('date_corrections',c_date,'splits',c_split,'new_rows',c_newrows,
    'skip_invariant',c_skip_inv,'skip_paid_spans',c_skip_paid,'already_split',c_already,'flagged',flagged);
end; $$;

-- BACKFILL RUN (manuale, già eseguito su NZ il 2026-06-16 con backup
-- backup_20260616_rate.payables): select public.fn_backfill_payable_installments((select id from companies limit 1));
