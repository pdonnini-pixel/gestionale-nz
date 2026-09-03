-- 20260903_170_bridge_termini_fattura_vincono.sql
--
-- REGOLA (Patrizio, 03/09/2026): quando arriva una fattura passiva, il bridge
-- A-Cube DEVE leggere la MODALITA' di pagamento (ModalitaPagamento, MP01..MP23)
-- e la TIPOLOGIA di pagamento (CondizioniPagamento TP01 rate / TP02 completo /
-- TP03 anticipo, piu' le DataScadenzaPagamento) scritte nella fattura. Se il
-- fornitore le ha scritte in fattura, vuol dire che si aspetta QUELLE: valgono
-- sul piano di pagamento caricato in anagrafica.
--
-- Caso che ha fatto emergere il bug: BELLA BIJOUX fattura 524 del 04/08/2026,
-- in fattura «MP05 bonifico, TP02, scadenza 05/08/2026». Il bridge ha ignorato
-- tutto e ha generato la scadenza dal piano fornitore (fine mese 30 gg ->
-- 30/09/2026, metodo del fornitore, payment_method_code NULL). Stesso difetto
-- su tutte le fatture a rata unica dei 241 fornitori con piano: il piano
-- (migration 089) doveva essere un FALLBACK, ma il ramo «rata unica» lo faceva
-- passare PRIMA dei termini scritti in fattura. La guida utente diceva gia' la
-- cosa giusta («se la fattura ha una sua scadenza vale sempre quella»): ora il
-- codice fa quello che la guida promette.
--
-- Effetto collaterale grave del vecchio ordine: le fatture pagate con CARTA
-- (MP08) restavano APERTE nello scadenzario, perche' il ramo piano azzerava
-- payment_method_code e il trigger fn_mp08_autopay (083) non scattava.
--
-- NUOVA PRECEDENZA nel bridge sync_acube_sdi_passive_to_payable:
--   1. la fattura porta N>=2 rate che quadrano col totale  -> N scadenze dalla fattura
--   2. la fattura porta almeno una scadenza con importo     -> 1 scadenza alla data
--      in fattura, importo totale, metodo mappato dal codice MP
--   3. nessun termine in fattura + fornitore con piano       -> piano fornitore (089)
--   4. altrimenti                                            -> rata unica a data fattura
-- In 1 e 2 il metodo viene da fn_sdi_mp_to_payment_method(MP, default fornitore):
-- il codice MP decide la FAMIGLIA (bonifico / riba / carta / sdd / contanti...),
-- e se il fornitore ha gia' una variante della stessa famiglia (riba_60,
-- riba_90, carta_debito, sdd_b2b...) si conserva quella, perche' la fattura
-- non distingue il termine RI.BA. In tutti i rami si assegna la banca di
-- pagamento del fornitore (serve a distinte e cash flow).
-- Inoltre electronic_invoices.payment_method / payment_terms ricevono il codice
-- MP e TP letti dalla fattura (prima restavano NULL dal bridge).
--
-- NON tocca dati esistenti: solo CREATE OR REPLACE di funzioni. Le scadenze gia'
-- generate dal piano restano come sono (eventuale riallineamento = decisione
-- separata di Patrizio, con backup).
-- REGOLA #0 (parita' tenant): NZ -> Made -> Zago, stesso file.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Codice MP (FatturaPA) -> enum payment_method, conservando la variante del
--    fornitore quando la famiglia coincide.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sdi_mp_to_payment_method(p_mp text, p_supplier_default text DEFAULT NULL)
 RETURNS public.payment_method
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mp  text := upper(trim(coalesce(p_mp, '')));
  v_def text := lower(trim(coalesce(p_supplier_default, '')));
  v_def_enum public.payment_method;
  v_fam text;
BEGIN
  -- default fornitore valido? (se no: bonifico ordinario)
  BEGIN
    v_def_enum := nullif(v_def, '')::public.payment_method;
  EXCEPTION WHEN others THEN
    v_def_enum := NULL;
  END;
  IF v_def_enum IS NULL THEN v_def_enum := 'bonifico_ordinario'::public.payment_method; END IF;

  v_fam := CASE v_mp
    WHEN 'MP01' THEN 'contanti'
    WHEN 'MP02' THEN 'assegno'
    WHEN 'MP03' THEN 'assegno'             -- assegno circolare
    WHEN 'MP04' THEN 'contanti'            -- contanti presso Tesoreria
    WHEN 'MP05' THEN 'bonifico'
    WHEN 'MP06' THEN 'altro'               -- vaglia cambiario
    WHEN 'MP07' THEN 'bollettino_postale'  -- bollettino bancario
    WHEN 'MP08' THEN 'carta'               -- carta di pagamento
    WHEN 'MP09' THEN 'rid'
    WHEN 'MP10' THEN 'rid'                 -- RID utenze
    WHEN 'MP11' THEN 'rid'                 -- RID veloce
    WHEN 'MP12' THEN 'riba'
    WHEN 'MP13' THEN 'mav'
    WHEN 'MP14' THEN 'altro'               -- quietanza erario
    WHEN 'MP15' THEN 'altro'               -- giroconto contabilita' speciale
    WHEN 'MP16' THEN 'sdd'                 -- domiciliazione bancaria
    WHEN 'MP17' THEN 'bollettino_postale'  -- domiciliazione postale
    WHEN 'MP18' THEN 'bollettino_postale'  -- bollettino c/c postale
    WHEN 'MP19' THEN 'sdd'                 -- SEPA Direct Debit
    WHEN 'MP20' THEN 'sdd'                 -- SEPA DD CORE
    WHEN 'MP21' THEN 'sdd_b2b'             -- SEPA DD B2B
    WHEN 'MP22' THEN 'compensazione'       -- trattenuta su somme gia' riscosse
    WHEN 'MP23' THEN 'altro'               -- PagoPA
    ELSE NULL END;

  -- codice assente o sconosciuto: vale il default del fornitore
  IF v_fam IS NULL THEN RETURN v_def_enum; END IF;

  -- stessa famiglia del default fornitore: si conserva la variante (riba_60, riba_90,
  -- bonifico_urgente, carta_debito, sdd_b2b...) perche' la fattura non la distingue
  IF v_fam = 'bonifico' AND v_def LIKE 'bonifico%' THEN RETURN v_def_enum; END IF;
  IF v_fam = 'riba'     AND v_def LIKE 'riba\_%'   THEN RETURN v_def_enum; END IF;
  IF v_fam = 'carta'    AND v_def IN ('carta_credito', 'carta_debito') THEN RETURN v_def_enum; END IF;
  IF v_fam IN ('sdd', 'rid', 'sdd_b2b') AND v_def IN ('rid', 'sdd_core', 'sdd_b2b') THEN RETURN v_def_enum; END IF;

  RETURN (CASE v_fam
    WHEN 'bonifico' THEN 'bonifico_ordinario'
    WHEN 'riba'     THEN 'riba_30'
    WHEN 'carta'    THEN 'carta_credito'
    WHEN 'sdd'      THEN 'sdd_core'
    ELSE v_fam END)::public.payment_method;
END;
$function$;

-- Etichetta leggibile del codice MP (stessa tabella di src/lib/parsers/xmlInvoiceParser.ts)
CREATE OR REPLACE FUNCTION public.fn_sdi_mp_label(p_mp text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE upper(trim(coalesce(p_mp, '')))
    WHEN 'MP01' THEN 'Contanti'
    WHEN 'MP02' THEN 'Assegno'
    WHEN 'MP03' THEN 'Assegno circolare'
    WHEN 'MP04' THEN 'Contanti presso Tesoreria'
    WHEN 'MP05' THEN 'Bonifico'
    WHEN 'MP06' THEN 'Vaglia cambiario'
    WHEN 'MP07' THEN 'Bollettino bancario'
    WHEN 'MP08' THEN 'Carta di pagamento'
    WHEN 'MP09' THEN 'RID'
    WHEN 'MP10' THEN 'RID utenze'
    WHEN 'MP11' THEN 'RID veloce'
    WHEN 'MP12' THEN 'RIBA'
    WHEN 'MP13' THEN 'MAV'
    WHEN 'MP14' THEN 'Quietanza erario'
    WHEN 'MP15' THEN 'Giroconto su conti di contabilità speciale'
    WHEN 'MP16' THEN 'Domiciliazione bancaria'
    WHEN 'MP17' THEN 'Domiciliazione postale'
    WHEN 'MP18' THEN 'Bollettino di c/c postale'
    WHEN 'MP19' THEN 'SEPA Direct Debit'
    WHEN 'MP20' THEN 'SEPA Direct Debit CORE'
    WHEN 'MP21' THEN 'SEPA Direct Debit B2B'
    WHEN 'MP22' THEN 'Trattenuta su somme già riscosse'
    WHEN 'MP23' THEN 'PagoPA'
    ELSE NULL END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) CondizioniPagamento (TP01 rate / TP02 completo / TP03 anticipo) dall'XML
--    o dal payload JSON A-Cube.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_parse_invoice_condizioni(p_xml text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_xml xml; v_tp text;
BEGIN
  IF p_xml IS NULL THEN RETURN NULL; END IF;
  BEGIN v_xml := p_xml::xml; EXCEPTION WHEN others THEN RETURN NULL; END;
  BEGIN
    v_tp := (xpath('//*[local-name()="DatiPagamento"]/*[local-name()="CondizioniPagamento"]/text()', v_xml))[1]::text;
  EXCEPTION WHEN others THEN RETURN NULL; END;
  RETURN nullif(upper(trim(v_tp)), '');
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_parse_invoice_condizioni_json(p_payload jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_body jsonb; v_dp jsonb; v_tp text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_payload->'fattura_elettronica_body') <> 'array' THEN RETURN NULL; END IF;
  FOR v_body IN SELECT * FROM jsonb_array_elements(p_payload->'fattura_elettronica_body') LOOP
    IF jsonb_typeof(v_body) <> 'object' OR jsonb_typeof(v_body->'dati_pagamento') <> 'array' THEN CONTINUE; END IF;
    FOR v_dp IN SELECT * FROM jsonb_array_elements(v_body->'dati_pagamento') LOOP
      IF jsonb_typeof(v_dp) <> 'object' THEN CONTINUE; END IF;
      v_tp := nullif(upper(trim(v_dp->>'condizioni_pagamento')), '');
      IF v_tp IS NOT NULL THEN RETURN v_tp; END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Bridge A-Cube passivo: i termini in fattura vincono sul piano fornitore.
-- ─────────────────────────────────────────────────────────────────────────
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
  v_tp text;                       -- CondizioniPagamento (TP01/TP02/TP03)
  v_method public.payment_method;  -- metodo mappato dal codice MP della fattura
  v_note text;
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

  -- Termini di pagamento scritti in fattura: scadenze + importi + codice MP (XML,
  -- altrimenti payload JSON A-Cube) e tipologia TP.
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
  -- Codice MP anche quando la fattura non ha scadenza/importo (es. MP08 senza data):
  -- serve comunque per metodo e chiusura automatica carta.
  if v_mets is null or v_mets[1] is null then
    select array_agg(method order by installment) into v_mets
    from public.fn_parse_invoice_payments(v_realxml) where method is not null;
    if v_mets is null then
      select array_agg(method order by installment) into v_mets
      from public.fn_parse_invoice_payments_json(NEW.payload) where method is not null;
    end if;
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

  -- Metodo: famiglia dal codice MP in fattura, variante dal fornitore (vedi fn_sdi_mp_to_payment_method)
  v_method := public.fn_sdi_mp_to_payment_method(v_mets[1], v_smethod);

  insert into public.electronic_invoices (id, company_id, invoice_number, invoice_date, supplier_name, supplier_vat,
    net_amount, vat_amount, gross_amount, due_date, sdi_id, sdi_status, tipo_documento, source, xml_content, acube_uuid, codice_destinatario,
    payment_method, payment_terms, created_at)
  values (gen_random_uuid(), v_company_id, NEW.invoice_number, NEW.invoice_date, v_name, NEW.sender_vat,
    v_net, v_vat, NEW.total_amount, coalesce(v_dues[1], v_due_fallback), NEW.sdi_file_id, public._acube_marking_to_sdi_status(NEW.marking), NEW.document_type, 'api_acube_sdi',
    v_xml, NEW.acube_uuid, NEW.recipient_code,
    v_mets[1], v_tp, now())
  on conflict (acube_uuid) do nothing returning id into v_electronic_invoice_id;
  if v_electronic_invoice_id is null then
    select id into v_electronic_invoice_id from public.electronic_invoices where acube_uuid = NEW.acube_uuid;
  end if;

  -- >>> GUARD reverse charge (fix 131) <<<
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
            || case when v_tp is not null then ' ' || v_tp else '' end;
  tol := greatest(0.05, coalesce(NEW.total_amount,0)*0.001);

  if coalesce(NEW.total_amount,0) > 0 and n is not null and n >= 2 and abs(sum_rate - NEW.total_amount) <= tol then
    -- 1) RATE SCRITTE IN FATTURA (quadrano col totale): una scadenza per rata
    v_amts[n] := round(NEW.total_amount - (select coalesce(sum(a),0) from unnest(v_amts[1:n-1]) a), 2);
    for i in 1..n loop
      insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
        gross_amount, status, payment_method, payment_method_code, payment_method_label, payment_bank_account_id, electronic_invoice_id,
        acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, notes, created_at)
      values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[i], v_dues[i],
        v_amts[i], 'da_pagare'::payable_status,
        public.fn_sdi_mp_to_payment_method(coalesce(v_mets[i], v_mets[1]), v_smethod), coalesce(v_mets[i], v_mets[1]),
        public.fn_sdi_mp_label(coalesce(v_mets[i], v_mets[1])), v_bank, v_electronic_invoice_id,
        case when i = 1 then NEW.acube_uuid else null end, v_name, NEW.sender_vat, i, n, v_note, now())
      on conflict do nothing;
    end loop;
  elsif coalesce(n,0) >= 1 then
    -- 2) SCADENZA SCRITTA IN FATTURA (rata unica, o rate che non quadrano): vale
    --    la data del fornitore, importo totale, metodo dal codice MP.
    insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
      gross_amount, status, payment_method, payment_method_code, payment_method_label, payment_bank_account_id, electronic_invoice_id,
      acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, notes, created_at)
    values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, v_dues[1], v_dues[1],
      NEW.total_amount, 'da_pagare'::payable_status,
      v_method, v_mets[1], public.fn_sdi_mp_label(v_mets[1]), v_bank, v_electronic_invoice_id,
      NEW.acube_uuid, v_name, NEW.sender_vat, 1, 1, v_note, now())
    on conflict do nothing;
  elsif NEW.invoice_date >= DATE '2026-07-31'
        and v_pb is not null and v_nrate is not null and coalesce(NEW.total_amount,0) <> 0 then
    -- 3) NESSUN TERMINE IN FATTURA: piano fornitore (089). Il metodo resta quello
    --    del fornitore, ma se la fattura porta un codice MP (senza data) lo si
    --    conserva, cosi' la carta (MP08) si chiude da sola.
    for rec in
      select rata, due_date, importo
      from public.fn_supplier_installment_schedule(NEW.invoice_date, v_pb, v_prima, v_nrate, NEW.total_amount)
    loop
      insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
        gross_amount, status, payment_method, payment_method_code, payment_method_label, payment_bank_account_id, electronic_invoice_id,
        acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, notes, created_at)
      values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date, rec.due_date, rec.due_date,
        rec.importo, 'da_pagare'::payable_status,
        v_method, v_mets[1], public.fn_sdi_mp_label(v_mets[1]), v_bank, v_electronic_invoice_id,
        case when rec.rata = 1 then NEW.acube_uuid else null end, v_name, NEW.sender_vat, rec.rata, v_nrate,
        'Auto-generata da piano fornitore (fattura senza termini di pagamento)', now())
      on conflict do nothing;
    end loop;
  else
    -- 4) FALLBACK: rata unica a data fattura
    insert into public.payables (id, company_id, supplier_id, invoice_number, invoice_date, due_date, original_due_date,
      gross_amount, status, payment_method, payment_method_code, payment_method_label, payment_bank_account_id, electronic_invoice_id,
      acube_uuid, supplier_name, supplier_vat, installment_number, installment_total, created_at)
    values (gen_random_uuid(), v_company_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date,
      v_due_fallback, v_due_fallback,
      NEW.total_amount, 'da_pagare'::payable_status, v_method, v_mets[1], public.fn_sdi_mp_label(v_mets[1]), v_bank,
      v_electronic_invoice_id, NEW.acube_uuid, v_name, NEW.sender_vat, 1, 1, now())
    on conflict do nothing;
  end if;
  return NEW;
end; $function$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFICA (per tenant)
-- select public.fn_sdi_mp_to_payment_method('MP05','riba_60');   -- bonifico_ordinario
-- select public.fn_sdi_mp_to_payment_method('MP12','riba_90');   -- riba_90 (variante conservata)
-- select public.fn_sdi_mp_to_payment_method('MP08','bonifico_ordinario'); -- carta_credito
-- select public.fn_sdi_mp_to_payment_method(null,'riba_30');     -- riba_30 (default fornitore)
-- select md5(pg_get_functiondef('public.sync_acube_sdi_passive_to_payable'::regproc)); -- uguale sui 3 tenant
