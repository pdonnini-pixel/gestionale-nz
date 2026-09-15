-- 20260903_170_ritenuta_acconto_payables.sql
--
-- CICLO PASSIVO — RITENUTA D'ACCONTO sulle fatture dei professionisti.
--
-- Caso reale (NZ, settembre 2026): bonifico del 06/03/2026 a SIGNORINI ASSOCIATI
-- di 6.822,15 € «saldo progetto di notula», mentre in Scadenzario la fattura 191
-- del 09/03/2026 vale 8.098,75 €. La differenza (1.276,60 €) e' la ritenuta
-- d'acconto 20% (RT02) che l'azienda trattiene e versa all'Erario con l'F24.
-- La fattura SDI lo dichiara gia': <ImportoTotaleDocumento>8098.75</...> e
-- <ImportoPagamento>6822.15</...>. Il gestionale pero' creava la scadenza al
-- LORDO, quindi:
--   - il motore di riconciliazione cercava 8.098,75 e non trovava mai 6.822,15;
--   - la distinta proponeva al fornitore un bonifico piu' alto del dovuto;
--   - in Banche il movimento restava «da riconciliare» per sempre.
-- Su NZ sono 8 fatture (Signorini, Scandella, Rocciola, Valia, Boschetti,
-- Marchetti, Impresa Valdarno, Rubini); Made e Zago oggi non ne hanno.
--
-- MODELLO ADOTTATO (una sola convenzione, valida ovunque):
--   payables.gross_amount        = DOVUTO AL FORNITORE, gia' al netto della ritenuta
--                                  (e' l'importo che esce dalla banca).
--   payables.withholding_amount  = quota di ritenuta della rata (NUOVA colonna).
--   totale documento della rata  = gross_amount + withholding_amount.
--   electronic_invoices.gross_amount resta il totale documento (costo / IVA);
--   electronic_invoices.withholding_amount (NUOVA) = ritenuta letta dall'XML.
-- Cosi' motore di riconciliazione, distinte, chiusure, residui e cashflow, che
-- ragionano tutti su gross_amount / amount_remaining, restano INVARIATI e
-- tornano a quadrare con la banca. Solo la creazione delle scadenze cambia.
--
-- COSA FA:
--   1. Colonne additive withholding_amount su electronic_invoices e payables.
--   2. fn_invoice_withholding(xml, payload): somma di tutti gli <ImportoRitenuta>
--      (fallback sul payload JSON A-Cube).
--   3. Trigger BEFORE su electronic_invoices che valorizza withholding_amount
--      dall'XML.
--   4. fn_invoice_to_payable (import XML / SDI diretto) e
--      sync_acube_sdi_passive_to_payable (bridge A-Cube): scadenze al netto
--      della ritenuta, rate dall'XML accettate quando la loro somma e' il netto
--      (prima venivano scartate proprio per la ritenuta), ritenuta ripartita
--      pro-quota sulle rate.
--   5. fn_payable_autofill_split: imponibile/IVA proporzionati sul totale
--      documento della rata (gross + ritenuta), non sul solo dovuto.
--   6. fn_prevent_duplicate_payable: il merge notula→SDI propaga la ritenuta.
--   7. Backfill dei payables gia' esistenti collegati a fatture con ritenuta,
--      con BACKUP in tabella (payables_bak_ritenuta_20260903) prima di ogni
--      UPDATE. Nessun DELETE.
--
-- PARITA' TENANT (Regola #0): applicare su NZ + Made + Zago, in quest'ordine.
-- Il backfill e' generico: dove non ci sono fatture con ritenuta non fa nulla.
-- Rollback: 20260903_170_ritenuta_acconto_payables_ROLLBACK.sql

BEGIN;

-- ─── 1. Colonne (additive, con default: non bloccano) ────────────────────────
ALTER TABLE public.electronic_invoices
  ADD COLUMN IF NOT EXISTS withholding_amount numeric NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.electronic_invoices.withholding_amount IS
  'Ritenuta d''acconto dichiarata nella fattura (somma di DatiRitenuta/ImportoRitenuta). gross_amount resta il totale documento.';

ALTER TABLE public.payables
  ADD COLUMN IF NOT EXISTS withholding_amount numeric NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.payables.withholding_amount IS
  'Quota di ritenuta d''acconto della rata. gross_amount e'' il DOVUTO AL FORNITORE gia'' al netto della ritenuta: totale documento della rata = gross_amount + withholding_amount. La ritenuta si versa all''Erario con F24.';

-- ─── 2. Helper: ritenuta dall'XML (tutti i DatiRitenuta), fallback JSON ──────
CREATE OR REPLACE FUNCTION public.fn_invoice_withholding(p_xml text, p_payload jsonb DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_realxml text; v_xml xml; v_nodes xml[]; v_node xml; v_txt text;
  v_tot numeric := 0; v_found boolean := false;
  v_body jsonb; v_r jsonb; v_e jsonb; v_bodies jsonb;
BEGIN
  v_realxml := ltrim(p_xml, chr(65279) || E' \t\r\n');
  IF v_realxml IS NOT NULL AND left(v_realxml, 1) = '<' THEN
    BEGIN
      v_xml := v_realxml::xml;
      v_nodes := xpath('//*[local-name()="DatiGeneraliDocumento"]/*[local-name()="DatiRitenuta"]/*[local-name()="ImportoRitenuta"]/text()', v_xml);
      IF array_length(v_nodes, 1) IS NOT NULL THEN
        FOREACH v_node IN ARRAY v_nodes LOOP
          v_txt := v_node::text;
          BEGIN
            v_tot := v_tot + nullif(trim(v_txt), '')::numeric;
            v_found := true;
          EXCEPTION WHEN OTHERS THEN NULL; END;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_found := false; v_tot := 0;
    END;
    IF v_found THEN RETURN round(v_tot, 2); END IF;
  END IF;

  -- Fallback: payload JSON A-Cube (dati_ritenuta puo' essere oggetto o array)
  IF p_payload IS NOT NULL AND jsonb_typeof(p_payload) = 'object' THEN
    v_bodies := p_payload->'fattura_elettronica_body';
    IF v_bodies IS NOT NULL AND jsonb_typeof(v_bodies) = 'array' THEN
      FOR v_body IN SELECT * FROM jsonb_array_elements(v_bodies) LOOP
        v_r := v_body #> '{dati_generali,dati_generali_documento,dati_ritenuta}';
        IF v_r IS NULL THEN CONTINUE; END IF;
        IF jsonb_typeof(v_r) = 'array' THEN
          FOR v_e IN SELECT * FROM jsonb_array_elements(v_r) LOOP
            BEGIN v_tot := v_tot + nullif(trim(coalesce(v_e->>'importo_ritenuta', '')), '')::numeric;
            EXCEPTION WHEN OTHERS THEN NULL; END;
          END LOOP;
        ELSIF jsonb_typeof(v_r) = 'object' THEN
          BEGIN v_tot := v_tot + nullif(trim(coalesce(v_r->>'importo_ritenuta', '')), '')::numeric;
          EXCEPTION WHEN OTHERS THEN NULL; END;
        END IF;
      END LOOP;
    END IF;
  END IF;
  RETURN round(coalesce(v_tot, 0), 2);
END;
$$;

-- ─── 3. Trigger BEFORE su electronic_invoices: ritenuta dall'XML ─────────────
CREATE OR REPLACE FUNCTION public.fn_electronic_invoice_withholding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_payload jsonb := NULL; v_wh numeric;
BEGIN
  IF NEW.xml_content IS NULL OR btrim(NEW.xml_content) = '' THEN RETURN NEW; END IF;
  -- Nel bridge A-Cube, senza XML reale, in xml_content finisce il payload JSON.
  IF left(ltrim(NEW.xml_content, chr(65279) || E' \t\r\n'), 1) = '{' THEN
    BEGIN v_payload := NEW.xml_content::jsonb; EXCEPTION WHEN OTHERS THEN v_payload := NULL; END;
  END IF;
  v_wh := public.fn_invoice_withholding(NEW.xml_content, v_payload);
  -- Riscrive solo se ha trovato qualcosa o se il valore corrente e' vuoto:
  -- un valore impostato a mano non viene mai azzerato da un XML illeggibile.
  IF coalesce(v_wh, 0) <> 0 OR coalesce(NEW.withholding_amount, 0) = 0 THEN
    NEW.withholding_amount := coalesce(v_wh, 0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_electronic_invoice_withholding ON public.electronic_invoices;
CREATE TRIGGER trg_electronic_invoice_withholding
  BEFORE INSERT OR UPDATE OF xml_content ON public.electronic_invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_electronic_invoice_withholding();

-- ─── 4a. fn_invoice_to_payable: scadenze al netto della ritenuta ─────────────
-- Base: 20260617_080. Modifiche: v_wh / v_due (netto), rate accettate se la
-- loro somma e' il netto (o il lordo: in tal caso vengono riproporzionate),
-- ritenuta ripartita pro-quota, withholding_amount su ogni insert.
CREATE OR REPLACE FUNCTION public.fn_invoice_to_payable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
declare
  v_supplier_id uuid; v_due date; n int; sum_rate numeric; tol numeric; i int;
  v_dues date[]; v_amts numeric[]; v_mets text[]; v_whs numeric[];
  v_wh numeric := 0; v_net_due numeric;
begin
  if NEW.acube_uuid is not null then return NEW; end if;
  select id into v_supplier_id from suppliers where company_id = NEW.company_id
    and ((NEW.supplier_vat is not null and vat_number = NEW.supplier_vat) or (NEW.supplier_name is not null and name ilike NEW.supplier_name)) limit 1;

  -- Ritenuta d'acconto: la scadenza nasce al NETTO (dovuto al fornitore).
  if coalesce(NEW.gross_amount, 0) > 0 then
    v_wh := least(greatest(coalesce(NEW.withholding_amount, 0), 0), NEW.gross_amount);
  end if;
  v_net_due := round(coalesce(NEW.gross_amount, 0) - v_wh, 2);

  select array_agg(due_date order by installment), array_agg(amount order by installment), array_agg(method order by installment), count(*), coalesce(sum(amount),0)
    into v_dues, v_amts, v_mets, n, sum_rate from public.fn_parse_invoice_payments(NEW.xml_content) where due_date is not null and amount is not null;

  if coalesce(NEW.gross_amount,0) <= 0 or n is null or n = 0 then
    v_due := coalesce(NEW.due_date, NEW.invoice_date);
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, net_amount, vat_amount, gross_amount, withholding_amount, amount_remaining, electronic_invoice_id, import_batch_id, payment_method_code, installment_number, installment_total, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_due, v_due, NEW.net_amount, NEW.vat_amount, v_net_due, v_wh, v_net_due, NEW.id, NEW.import_batch_id, NEW.payment_method, 1, 1, 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
    return NEW;
  end if;

  tol := greatest(0.05, NEW.gross_amount*0.001);
  if abs(sum_rate - v_net_due) <= tol then
    null; -- rate gia' al netto della ritenuta (caso standard SDI): si usano cosi' come sono
  elsif v_wh > 0 and abs(sum_rate - NEW.gross_amount) <= tol then
    -- rate espresse al lordo: riproporzionate sul netto dovuto
    for i in 1..n loop v_amts[i] := round(v_amts[i] * v_net_due / NEW.gross_amount, 2); end loop;
  else
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, net_amount, vat_amount, gross_amount, withholding_amount, amount_remaining, electronic_invoice_id, import_batch_id, payment_method_code, installment_number, installment_total, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[1], v_dues[1], NEW.net_amount, NEW.vat_amount, v_net_due, v_wh, v_net_due, NEW.id, NEW.import_batch_id, coalesce(v_mets[1], NEW.payment_method), 1, 1, 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
    return NEW;
  end if;

  if n = 1 then
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, net_amount, vat_amount, gross_amount, withholding_amount, amount_remaining, electronic_invoice_id, import_batch_id, payment_method_code, installment_number, installment_total, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[1], v_dues[1], NEW.net_amount, NEW.vat_amount, v_net_due, v_wh, v_net_due, NEW.id, NEW.import_batch_id, coalesce(v_mets[1], NEW.payment_method), 1, 1, 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
    return NEW;
  end if;

  -- Piu' rate: l'ultima chiude al centesimo; ritenuta ripartita pro-quota.
  v_amts[n] := round(v_net_due - (select coalesce(sum(a),0) from unnest(v_amts[1:n-1]) a), 2);
  for i in 1..n loop
    v_whs[i] := case when v_wh > 0 and v_net_due <> 0 then round(v_wh * v_amts[i] / v_net_due, 2) else 0 end;
  end loop;
  if v_wh > 0 then
    v_whs[n] := round(v_wh - (select coalesce(sum(w),0) from unnest(v_whs[1:n-1]) w), 2);
  end if;
  for i in 1..n loop
    insert into payables (company_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date, gross_amount, withholding_amount, amount_remaining, electronic_invoice_id, import_batch_id, installment_number, installment_total, payment_method_code, notes, created_at, updated_at)
    values (NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[i], v_dues[i], v_amts[i], v_whs[i], v_amts[i], NEW.id, NEW.import_batch_id, i, n, coalesce(v_mets[i], NEW.payment_method), 'Auto-generata da fattura elettronica', now(), now()) on conflict do nothing;
  end loop;
  return NEW;
end; $function$;

-- ─── 4b. sync_acube_sdi_passive_to_payable: bridge A-Cube al netto ───────────
-- Base: 20260731_131 (guard reverse charge incluso). Modifiche: v_wh / v_due_total,
-- withholding_amount su electronic_invoices e su ogni payable, rate accettate
-- se la loro somma e' il netto (o il lordo → riproporzionate), piano fornitore
-- calcolato sul netto dovuto, ritenuta ripartita pro-quota.
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
  v_wh numeric := 0; v_due_total numeric; v_whs numeric[]; v_total numeric;
  v_plan_amts numeric[]; v_plan_dues date[]; v_plan_n int;
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

  -- Ritenuta d'acconto (XML, fallback payload JSON). Il dovuto al fornitore e'
  -- il totale documento meno la ritenuta; il segno segue il documento.
  v_total := coalesce(NEW.total_amount, 0);
  v_wh := coalesce(public.fn_invoice_withholding(v_realxml, NEW.payload), 0);
  if v_wh < 0 or v_wh > abs(v_total) then v_wh := 0; end if;
  v_due_total := round(abs(v_total) - v_wh, 2);

  select array_agg(due_date order by installment), array_agg(amount order by installment),
         array_agg(method order by installment), count(*), coalesce(sum(amount),0)
    into v_dues, v_amts, v_mets, n, sum_rate
  from public.fn_parse_invoice_payments(v_realxml) where due_date is not null and amount is not null;
  if coalesce(n,0) = 0 then
    select array_agg(due_date order by installment), array_agg(amount order by installment),
           array_agg(method order by installment), count(*), coalesce(sum(amount),0)
      into v_dues, v_amts, v_mets, n, sum_rate
      from public.fn_parse_invoice_payments_json(NEW.payload) where due_date is not null and amount is not null;
  end if;
  v_due_fallback := NEW.invoice_date;
  select id into v_supplier_id from public.suppliers
  where company_id = v_company_id and (partita_iva = NEW.sender_vat or vat_number = NEW.sender_vat) limit 1;
  if v_supplier_id is null then
    insert into public.suppliers (id, company_id, name, ragione_sociale, vat_number, partita_iva, nazione, source, is_active, payment_terms, payment_method)
    values (gen_random_uuid(), v_company_id, v_name, v_name, NEW.sender_vat, NEW.sender_vat, coalesce(NEW.sender_country,'IT'), 'acube_sdi', true, 30, 'bonifico_ordinario')
    returning id into v_supplier_id;
  end if;
  select payment_base, prima_scadenza_gg, numero_rate, payment_bank_account_id, default_payment_method::text
    into v_pb, v_prima, v_nrate, v_bank, v_smethod
  from public.suppliers where id = v_supplier_id;
  insert into public.electronic_invoices (id, company_id, invoice_number, invoice_date, supplier_name, supplier_vat,
    net_amount, vat_amount, gross_amount, withholding_amount, due_date, sdi_id, sdi_status, tipo_documento, source, xml_content, acube_uuid, codice_destinatario, created_at)
  values (gen_random_uuid(), v_company_id, NEW.invoice_number, NEW.invoice_date, v_name, NEW.sender_vat,
    v_net, v_vat, NEW.total_amount, v_wh, coalesce(v_dues[1], v_due_fallback), NEW.sdi_file_id, public._acube_marking_to_sdi_status(NEW.marking), NEW.document_type, 'api_acube_sdi',
    v_xml, NEW.acube_uuid, NEW.recipient_code, now())
  on conflict (acube_uuid) do nothing returning id into v_electronic_invoice_id;
  if v_electronic_invoice_id is null then
    select id into v_electronic_invoice_id from public.electronic_invoices where acube_uuid = NEW.acube_uuid;
  end if;

  -- >>> GUARD reverse charge (fix 131) <<<
  -- TD16/TD17/TD18/TD19: documenti IVA auto-emessi dal cessionario, NON un
  -- debito verso il fornitore. Si archivia la fattura, nessuna scadenza.
  if upper(coalesce(NEW.document_type, '')) in ('TD16','TD17','TD18','TD19') then
    return NEW;
  end if;

  v_is_nc := upper(coalesce(NEW.document_type, '')) in ('TD04', 'TD08');
  if v_is_nc then
    insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
      gross_amount, withholding_amount, status, payment_method, payment_method_code, electronic_invoice_id, acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, created_at)
    values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date,
      coalesce(v_dues[1], v_due_fallback), coalesce(v_dues[1], v_due_fallback),
      -v_due_total, -v_wh, 'nota_credito'::payable_status, 'bonifico_ordinario'::payment_method, coalesce(v_mets[1], null),
      v_electronic_invoice_id, NEW.acube_uuid, v_name, NEW.sender_vat, 1, 1, now())
    on conflict do nothing;
    return NEW;
  end if;

  -- Rate dall'XML: valide se la somma e' il NETTO dovuto (standard SDI con
  -- ritenuta) oppure il LORDO (in tal caso riproporzionate sul netto).
  tol := greatest(0.05, coalesce(NEW.total_amount,0)*0.001);
  if coalesce(NEW.total_amount,0) > 0 and n is not null and n >= 2
     and v_wh > 0 and abs(sum_rate - NEW.total_amount) <= tol and abs(sum_rate - v_due_total) > tol then
    for i in 1..n loop v_amts[i] := round(v_amts[i] * v_due_total / NEW.total_amount, 2); end loop;
    sum_rate := v_due_total;
  end if;

  if coalesce(NEW.total_amount,0) > 0 and n is not null and n >= 2 and abs(sum_rate - v_due_total) <= tol then
    v_amts[n] := round(v_due_total - (select coalesce(sum(a),0) from unnest(v_amts[1:n-1]) a), 2);
    for i in 1..n loop
      v_whs[i] := case when v_wh > 0 and v_due_total <> 0 then round(v_wh * v_amts[i] / v_due_total, 2) else 0 end;
    end loop;
    if v_wh > 0 then v_whs[n] := round(v_wh - (select coalesce(sum(w),0) from unnest(v_whs[1:n-1]) w), 2); end if;
    insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
      gross_amount, withholding_amount, status, payment_method, payment_method_code, electronic_invoice_id, acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, created_at)
    values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[1], v_dues[1],
      v_amts[1], v_whs[1], 'da_pagare'::payable_status, 'bonifico_ordinario'::payment_method, coalesce(v_mets[1], null), v_electronic_invoice_id, NEW.acube_uuid, v_name, NEW.sender_vat, 1, n, now())
    on conflict do nothing;
    for i in 2..n loop
      insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
        gross_amount, withholding_amount, status, payment_method, payment_method_code, electronic_invoice_id, supplier_name, supplier_vat, installment_number, installment_total, created_at)
      values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[i], v_dues[i],
        v_amts[i], v_whs[i], 'da_pagare'::payable_status, 'bonifico_ordinario'::payment_method, coalesce(v_mets[i], null), v_electronic_invoice_id, v_name, NEW.sender_vat, i, n, now())
      on conflict do nothing;
    end loop;
  elsif NEW.invoice_date >= DATE '2026-07-31'
        and v_pb is not null and v_nrate is not null and coalesce(NEW.total_amount,0) <> 0 then
    -- Piano fornitore calcolato sul NETTO dovuto; ritenuta ripartita pro-quota.
    select array_agg(importo order by rata), array_agg(due_date order by rata), count(*)
      into v_plan_amts, v_plan_dues, v_plan_n
      from public.fn_supplier_installment_schedule(NEW.invoice_date, v_pb, v_prima, v_nrate, sign(NEW.total_amount) * v_due_total);
    for i in 1..coalesce(v_plan_n, 0) loop
      v_whs[i] := case when v_wh > 0 and v_due_total <> 0 then round(sign(NEW.total_amount) * v_wh * abs(v_plan_amts[i]) / v_due_total, 2) else 0 end;
    end loop;
    if v_wh > 0 and coalesce(v_plan_n, 0) > 0 then
      v_whs[v_plan_n] := round(sign(NEW.total_amount) * v_wh - (select coalesce(sum(w),0) from unnest(v_whs[1:v_plan_n-1]) w), 2);
    end if;
    for i in 1..coalesce(v_plan_n, 0) loop
      insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
        gross_amount, withholding_amount, status, payment_method, payment_method_code, payment_bank_account_id, electronic_invoice_id,
        acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, notes, created_at)
      values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_plan_dues[i], v_plan_dues[i],
        v_plan_amts[i], v_whs[i], 'da_pagare'::payable_status,
        coalesce(v_smethod::payment_method, 'bonifico_ordinario'::payment_method), null, v_bank, v_electronic_invoice_id,
        case when i = 1 then NEW.acube_uuid else null end, v_name, NEW.sender_vat, i, v_nrate,
        'Auto-generata da piano fornitore', now())
      on conflict do nothing;
    end loop;
  else
    insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
      gross_amount, withholding_amount, status, payment_method, payment_method_code, electronic_invoice_id, acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, created_at)
    values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date,
      coalesce(v_dues[1], v_due_fallback), coalesce(v_dues[1], v_due_fallback),
      sign(coalesce(NEW.total_amount, 1)) * v_due_total, sign(coalesce(NEW.total_amount, 1)) * v_wh, 'da_pagare'::payable_status, 'bonifico_ordinario'::payment_method, coalesce(v_mets[1], null), v_electronic_invoice_id, NEW.acube_uuid, v_name, NEW.sender_vat, 1, 1, now())
    on conflict do nothing;
  end if;
  return NEW;
end; $function$;

-- ─── 5. fn_payable_autofill_split: split sul totale documento della rata ─────
-- Base: 20260703_053. Il rapporto usa (gross + ritenuta) / totale documento,
-- cosi' imponibile e IVA della rata sono quelli del documento e non vengono
-- schiacciati dalla ritenuta.
CREATE OR REPLACE FUNCTION public.fn_payable_autofill_split()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $$
DECLARE
  v_ei_net   numeric;
  v_ei_vat   numeric;
  v_ei_gross numeric;
  v_doc      numeric;
  v_net      numeric;
BEGIN
  IF (NEW.net_amount IS NULL OR NEW.net_amount = 0)
     AND NEW.gross_amount IS NOT NULL AND NEW.gross_amount <> 0
     AND NEW.electronic_invoice_id IS NOT NULL
  THEN
    SELECT net_amount, vat_amount, gross_amount
      INTO v_ei_net, v_ei_vat, v_ei_gross
      FROM public.electronic_invoices
      WHERE id = NEW.electronic_invoice_id;

    IF v_ei_gross IS NOT NULL AND v_ei_gross <> 0
       AND v_ei_net IS NOT NULL AND v_ei_net <> 0
    THEN
      -- Totale documento della rata = dovuto + ritenuta (stesso segno del dovuto).
      v_doc := NEW.gross_amount + COALESCE(NEW.withholding_amount, 0);
      v_net := round(v_ei_net * (v_doc / v_ei_gross), 2);
      NEW.net_amount := v_net;
      NEW.vat_amount := round(v_doc - v_net, 2);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payable_autofill_split ON public.payables;
CREATE TRIGGER trg_payable_autofill_split
  BEFORE INSERT OR UPDATE OF gross_amount, electronic_invoice_id, net_amount, withholding_amount
  ON public.payables
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_payable_autofill_split();

-- ─── 6. fn_prevent_duplicate_payable: il merge propaga la ritenuta ───────────
-- Base: 20260720_098. Unica modifica: withholding_amount nei due UPDATE di merge.
CREATE OR REPLACE FUNCTION public.fn_prevent_duplicate_payable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  existing_id uuid; existing_status text;
  v_notula_merge boolean := false; v_cands uuid[]; v_norm text;
BEGIN
  IF NEW.is_forecast IS TRUE OR NEW.recurring_cost_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.electronic_invoice_id IS NOT NULL THEN
    SELECT id, status::text INTO existing_id, existing_status FROM payables
    WHERE company_id = NEW.company_id AND electronic_invoice_id = NEW.electronic_invoice_id
      AND COALESCE(installment_number,1) = COALESCE(NEW.installment_number,1)
    ORDER BY (status='annullato')::int ASC,
             (COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale'))::int DESC,
             created_at ASC LIMIT 1;
    IF existing_id IS NULL AND COALESCE(NEW.installment_number,1)=1 AND COALESCE(NEW.installment_total,1)=1 THEN
      v_norm := public.fn_normalize_invoice_number(NEW.invoice_number);
      IF v_norm <> '' THEN
        SELECT array_agg(id) INTO v_cands FROM payables
        WHERE company_id = NEW.company_id AND electronic_invoice_id IS NULL AND acube_uuid IS NULL
          AND status IS DISTINCT FROM 'annullato' AND COALESCE(installment_number,1)=1
          AND public.fn_normalize_invoice_number(invoice_number) = v_norm
          AND ((NEW.supplier_vat IS NOT NULL AND NEW.supplier_vat<>'' AND supplier_vat=NEW.supplier_vat)
               OR (NEW.supplier_id IS NOT NULL AND supplier_id=NEW.supplier_id)
               OR (NEW.supplier_name IS NOT NULL AND supplier_name=NEW.supplier_name));
        IF v_cands IS NOT NULL AND array_length(v_cands,1)=1 THEN existing_id:=v_cands[1]; v_notula_merge:=true; END IF;
      END IF;
      IF existing_id IS NULL AND NEW.gross_amount IS NOT NULL AND NEW.gross_amount<>0 THEN
        SELECT array_agg(id) INTO v_cands FROM payables
        WHERE company_id = NEW.company_id AND electronic_invoice_id IS NULL AND acube_uuid IS NULL
          AND status IS DISTINCT FROM 'annullato' AND COALESCE(installment_number,1)=1
          AND abs(coalesce(gross_amount,0) - NEW.gross_amount) < 0.01
          AND NEW.invoice_date IS NOT NULL AND invoice_date IS NOT NULL
          AND invoice_date BETWEEN (NEW.invoice_date - 200) AND (NEW.invoice_date + 45)
          AND ((NEW.supplier_vat IS NOT NULL AND NEW.supplier_vat<>'' AND supplier_vat=NEW.supplier_vat)
               OR (NEW.supplier_id IS NOT NULL AND supplier_id=NEW.supplier_id)
               OR (NEW.supplier_name IS NOT NULL AND supplier_name=NEW.supplier_name));
        IF v_cands IS NOT NULL AND array_length(v_cands,1)=1 THEN
          existing_id:=v_cands[1]; v_notula_merge:=true;
          SELECT status::text INTO existing_status FROM payables WHERE id=existing_id;
        END IF;
      END IF;
    END IF;
  ELSIF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN
    SELECT id, status::text INTO existing_id, existing_status FROM payables
    WHERE company_id = NEW.company_id AND electronic_invoice_id IS NULL
      AND invoice_number = NEW.invoice_number
      AND COALESCE(installment_number,1) = COALESCE(NEW.installment_number,1)
      AND ((supplier_id IS NOT NULL AND supplier_id=NEW.supplier_id)
           OR (supplier_vat IS NOT NULL AND supplier_vat<>'' AND supplier_vat=NEW.supplier_vat)
           OR (supplier_name IS NOT NULL AND supplier_name<>'' AND supplier_name=NEW.supplier_name))
    ORDER BY (status='annullato')::int ASC,
             (COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale'))::int DESC,
             created_at ASC LIMIT 1;
  ELSE RETURN NEW; END IF;
  IF existing_id IS NULL THEN RETURN NEW; END IF;
  IF v_notula_merge THEN
    UPDATE payables SET
      invoice_number=NEW.invoice_number, invoice_date=NEW.invoice_date,
      electronic_invoice_id=NEW.electronic_invoice_id, acube_uuid=COALESCE(acube_uuid,NEW.acube_uuid),
      net_amount=COALESCE(NEW.net_amount,net_amount), vat_amount=COALESCE(NEW.vat_amount,vat_amount),
      gross_amount=COALESCE(NEW.gross_amount,gross_amount),
      withholding_amount=COALESCE(NEW.withholding_amount,withholding_amount),
      due_date=CASE WHEN status IN ('pagato','parziale') THEN due_date ELSE COALESCE(NEW.due_date,due_date) END,
      original_due_date=COALESCE(original_due_date,NEW.original_due_date,NEW.due_date),
      payment_method=COALESCE(payment_method,NEW.payment_method),
      payment_method_code=COALESCE(payment_method_code,NEW.payment_method_code),
      supplier_id=COALESCE(supplier_id,NEW.supplier_id), supplier_name=COALESCE(NEW.supplier_name,supplier_name),
      supplier_vat=COALESCE(NEW.supplier_vat,supplier_vat), cost_category_id=COALESCE(cost_category_id,NEW.cost_category_id),
      notes=COALESCE(NULLIF(notes,''),'')||CASE WHEN COALESCE(notes,'')<>'' THEN ' ' ELSE '' END||'[Notula agganciata alla fattura SDI '||COALESCE(NEW.invoice_number,'')||']',
      updated_at=NOW()
    WHERE id=existing_id;
    RETURN NULL;
  END IF;
  IF existing_status IS DISTINCT FROM 'annullato' THEN
    UPDATE payables SET
      supplier_id=COALESCE(NEW.supplier_id,supplier_id), supplier_name=COALESCE(NEW.supplier_name,supplier_name),
      supplier_vat=COALESCE(NEW.supplier_vat,supplier_vat), gross_amount=COALESCE(NEW.gross_amount,gross_amount),
      withholding_amount=COALESCE(NEW.withholding_amount,withholding_amount),
      net_amount=COALESCE(NEW.net_amount,net_amount), vat_amount=COALESCE(NEW.vat_amount,vat_amount),
      due_date=COALESCE(NEW.due_date,due_date), original_due_date=COALESCE(original_due_date,NEW.original_due_date,NEW.due_date),
      payment_method=COALESCE(NEW.payment_method,payment_method), payment_method_code=COALESCE(NEW.payment_method_code,payment_method_code),
      payment_method_label=COALESCE(NEW.payment_method_label,payment_method_label), iban=COALESCE(NEW.iban,iban),
      installment_total=COALESCE(NEW.installment_total,installment_total),
      electronic_invoice_id=COALESCE(electronic_invoice_id,NEW.electronic_invoice_id), acube_uuid=COALESCE(acube_uuid,NEW.acube_uuid),
      cost_category_id=COALESCE(cost_category_id,NEW.cost_category_id), updated_at=NOW()
    WHERE id=existing_id;
  END IF;
  RETURN NULL;
END; $function$;

-- ─── 7. Backfill (con BACKUP, nessun DELETE) ─────────────────────────────────
-- 7a. Ritenuta sulle fatture elettroniche gia' archiviate.
UPDATE public.electronic_invoices ei
   SET withholding_amount = public.fn_invoice_withholding(ei.xml_content, NULL)
 WHERE ei.xml_content ILIKE '%<DatiRitenuta>%'
   AND coalesce(ei.withholding_amount, 0) = 0
   AND public.fn_invoice_withholding(ei.xml_content, NULL) > 0;

-- 7b. Backup dei payables interessati PRIMA di toccarli (REGOLA NO DATA LOSS).
CREATE TABLE IF NOT EXISTS public.payables_bak_ritenuta_20260903 (LIKE public.payables INCLUDING DEFAULTS);
ALTER TABLE public.payables_bak_ritenuta_20260903 ENABLE ROW LEVEL SECURITY;
INSERT INTO public.payables_bak_ritenuta_20260903
SELECT p.* FROM public.payables p
  JOIN public.electronic_invoices ei ON ei.id = p.electronic_invoice_id
 WHERE ei.withholding_amount > 0 AND coalesce(p.withholding_amount, 0) = 0;

-- 7c. Riallineamento: solo scadenze in rata unica, con importo ancora al lordo
--     (= totale documento) oppure gia' al netto (solo la quota ritenuta).
--     Rate multiple o importi modificati a mano: NON toccati, solo segnalati.
DO $$
DECLARE r record; v_new_gross numeric; v_new_paid numeric;
BEGIN
  FOR r IN
    SELECT p.id, p.invoice_number, p.supplier_name, p.gross_amount, p.amount_paid, p.status::text AS status,
           p.installment_total, ei.gross_amount AS doc_total, ei.withholding_amount AS wh
      FROM public.payables p
      JOIN public.electronic_invoices ei ON ei.id = p.electronic_invoice_id
     WHERE ei.withholding_amount > 0 AND coalesce(p.withholding_amount, 0) = 0
  LOOP
    IF coalesce(r.installment_total, 1) > 1 THEN
      RAISE NOTICE '[ritenuta] SALTATA (rate multiple) payable % fattura % %', r.id, r.invoice_number, r.supplier_name;
      CONTINUE;
    END IF;
    IF abs(abs(r.gross_amount) - r.doc_total) < 0.01 THEN
      -- ancora al lordo → porta il dovuto al netto
      v_new_gross := round(sign(r.gross_amount) * (r.doc_total - r.wh), 2);
      v_new_paid := CASE WHEN r.gross_amount > 0 AND coalesce(r.amount_paid, 0) > v_new_gross THEN v_new_gross ELSE r.amount_paid END;
      UPDATE public.payables
         SET gross_amount = v_new_gross,
             withholding_amount = sign(r.gross_amount) * r.wh,
             amount_paid = v_new_paid,
             updated_at = now()
       WHERE id = r.id;
      RAISE NOTICE '[ritenuta] payable % fattura % %: dovuto % → % (ritenuta %), pagato % → %',
        r.id, r.invoice_number, r.supplier_name, r.gross_amount, v_new_gross, r.wh, r.amount_paid, v_new_paid;
    ELSIF abs(abs(r.gross_amount) - (r.doc_total - r.wh)) < 0.01 THEN
      -- gia' al netto (sistemata a mano in passato) → registra solo la ritenuta
      UPDATE public.payables
         SET withholding_amount = sign(r.gross_amount) * r.wh, updated_at = now()
       WHERE id = r.id;
      RAISE NOTICE '[ritenuta] payable % fattura % %: gia'' al netto, registrata ritenuta %',
        r.id, r.invoice_number, r.supplier_name, r.wh;
    ELSE
      RAISE NOTICE '[ritenuta] SALTATA (importo modificato a mano: % vs doc % / netto %) payable % fattura % %',
        r.gross_amount, r.doc_total, r.doc_total - r.wh, r.id, r.invoice_number, r.supplier_name;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- ─── Verifica (da eseguire su ogni tenant dopo l'apply) ──────────────────────
-- select p.invoice_number, p.supplier_name, p.gross_amount, p.withholding_amount,
--        p.gross_amount + p.withholding_amount as totale_doc, ei.gross_amount as doc,
--        p.amount_paid, p.amount_remaining, p.status
--   from payables p join electronic_invoices ei on ei.id = p.electronic_invoice_id
--  where ei.withholding_amount > 0 order by p.invoice_date;
-- Atteso: totale_doc = doc per ogni riga; amount_remaining >= 0.
