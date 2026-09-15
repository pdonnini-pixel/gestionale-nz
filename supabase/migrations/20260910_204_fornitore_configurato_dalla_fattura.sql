-- 20260910_204 — Il fornitore nuovo nasce configurato dalla FATTURA (NZ+Made+Zago)
--
-- PERCHE' (Patrizio, 10/09/2026). «In Fatturazione arrivano anche fornitori nuovi e mi
-- crei una lista da caricare. Ma se arrivano vuol dire che sono arrivate delle fatture,
-- e le info sono tutte nella fattura, modalita' di pagamento compresa. Perche' non lo fai?»
-- Ha ragione. Il bridge A-Cube leggeva la fattura solo per generare la SCADENZA, e il
-- fornitore lo creava vuoto, con un default fisso uguale per tutti:
--     insert into suppliers (... payment_terms, payment_method) values (... 30, 'bonifico_ordinario')
-- Risultato sui dati veri di NZ al 10/09/2026: 269 fornitori su 269 senza codice fiscale,
-- senza indirizzo e senza regime fiscale, 256 senza IBAN, 180 senza categoria, 25 senza
-- piano di pagamento (che e' poi la riga rossa «fornitore non riconosciuto» in Fatturazione).
-- Intanto le fatture quei dati ce li avevano: 1.038 su 1.325 portano sede e regime fiscale
-- del cedente, 821 il codice fiscale, 222 delle 293 degli ultimi 60 giorni portano la
-- sezione dati_pagamento completa (IBAN, istituto, MP, TP, scadenze).
--
-- COSA FA
--   1. fn_invoice_cedente_profile — legge dal documento (JSON del bridge A-Cube o XML puro)
--      i dati del CedentePrestatore: codice fiscale, sede, regime fiscale, e IBAN/istituto
--      dal primo dettaglio di pagamento. L'IBAN passa da un controllo di forma.
--   2. fn_supplier_profile_from_invoice — scrive quei dati sul fornitore RIEMPIENDO SOLO
--      I CAMPI VUOTI, e ricava il piano di pagamento dalle scadenze dichiarate in fattura
--      (numero rate, giorni, base data fattura o fine mese) quando il fornitore non ne ha
--      ancora uno. Un valore messo a mano non viene mai sovrascritto: e' la stessa regola
--      dell'import XML manuale (importEngine.ts, «update IBAN if supplier doesn't have it yet»).
--      La categoria di default arriva dalle righe della fattura (fn_categorize_from_lines, 200).
--   3. sync_acube_sdi_passive_to_payable — il fornitore nuovo nasce col metodo DICHIARATO
--      in fattura invece del bonifico d'ufficio, e subito dopo passa dal profilo. Il piano
--      appena ricavato e' gia' disponibile per le rate di questa stessa fattura.
--   4. rpc_backfill_supplier_profiles — recupero dei fornitori gia' a sistema dalle loro
--      fatture (dalla piu' recente), idempotente perche' riempie solo i buchi.
--
-- NIENTE PERDITA DI DATI: solo UPDATE di campi NULL o stringa vuota, nessun DELETE, nessun
-- DROP. Le colonne aggiunte sono additive e servono a dire da quale fattura arriva il dato.
-- Rollback in _ROLLBACK.sql

BEGIN;

-- ── 1. tracciabilita': da quale fattura arriva il profilo ────────────────────
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS profile_from_invoice_id uuid REFERENCES public.electronic_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS profile_from_invoice_at timestamptz,
  ADD COLUMN IF NOT EXISTS profile_from_invoice_fields text[];

COMMENT ON COLUMN public.suppliers.profile_from_invoice_id IS
  'Ultima fattura elettronica da cui sono stati ricavati dati anagrafici o di pagamento del fornitore (solo campi che erano vuoti).';
COMMENT ON COLUMN public.suppliers.profile_from_invoice_fields IS
  'Elenco dei campi compilati leggendo la fattura, per distinguerli da quelli inseriti a mano.';

-- ── 2. dati del cedente dentro il documento ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_invoice_cedente_profile(p_doc text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_doc   text := btrim(coalesce(p_doc, ''), chr(65279) || E' \t\r\n');
  v_json  jsonb;
  v_ced   jsonb;
  v_det   jsonb;
  v_block text;
  v_pay   text;
  v_iban  text;
  v_ist   text;
  v_out   jsonb := '{}'::jsonb;
BEGIN
  IF v_doc = '' THEN RETURN v_out; END IF;

  IF left(v_doc, 1) = '{' THEN
    BEGIN v_json := v_doc::jsonb; EXCEPTION WHEN others THEN v_json := NULL; END;
  END IF;

  IF v_json IS NOT NULL THEN
    v_ced := v_json #> '{fattura_elettronica_header,cedente_prestatore}';
    IF v_ced IS NOT NULL AND jsonb_typeof(v_ced) = 'object' THEN
      v_out := jsonb_strip_nulls(jsonb_build_object(
        'codice_fiscale', nullif(btrim(coalesce(v_ced #>> '{dati_anagrafici,codice_fiscale}', '')), ''),
        'regime_fiscale', nullif(btrim(coalesce(v_ced #>> '{dati_anagrafici,regime_fiscale}', '')), ''),
        'indirizzo',      nullif(btrim(coalesce(v_ced #>> '{sede,indirizzo}', '')), ''),
        'cap',            nullif(btrim(coalesce(v_ced #>> '{sede,cap}', '')), ''),
        'comune',         nullif(btrim(coalesce(v_ced #>> '{sede,comune}', '')), ''),
        'provincia',      nullif(btrim(coalesce(v_ced #>> '{sede,provincia}', '')), ''),
        'nazione',        nullif(btrim(coalesce(v_ced #>> '{sede,nazione}', '')), '')
      ));
    END IF;

    SELECT d INTO v_det
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(v_json->'fattura_elettronica_body') = 'array'
                  THEN v_json->'fattura_elettronica_body' ELSE '[]'::jsonb END) b
      CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(b->'dati_pagamento') = 'array'
                  THEN b->'dati_pagamento' ELSE '[]'::jsonb END) dp
      CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(dp->'dettaglio_pagamento') = 'array'
                  THEN dp->'dettaglio_pagamento' ELSE '[]'::jsonb END) d
     WHERE nullif(btrim(coalesce(d->>'iban', '')), '') IS NOT NULL
     LIMIT 1;

    IF v_det IS NOT NULL THEN
      v_iban := upper(regexp_replace(coalesce(v_det->>'iban', ''), '\s', '', 'g'));
      v_ist  := nullif(btrim(coalesce(v_det->>'istituto_finanziario', '')), '');
    END IF;

  ELSE
    -- XML puro (anche con prefisso di namespace)
    v_block := substring(v_doc from '<[^>]*CedentePrestatore[^>]*>(.*?)</[^>]*CedentePrestatore[^>]*>');
    IF v_block IS NOT NULL THEN
      v_out := jsonb_strip_nulls(jsonb_build_object(
        'codice_fiscale', nullif(btrim(coalesce(substring(v_block from '<(?:[A-Za-z0-9]+:)?CodiceFiscale>([^<]*)<'), '')), ''),
        'regime_fiscale', nullif(btrim(coalesce(substring(v_block from '<(?:[A-Za-z0-9]+:)?RegimeFiscale>([^<]*)<'), '')), ''),
        'indirizzo',      nullif(btrim(coalesce(substring(v_block from '<(?:[A-Za-z0-9]+:)?Indirizzo>([^<]*)<'), '')), ''),
        'cap',            nullif(btrim(coalesce(substring(v_block from '<(?:[A-Za-z0-9]+:)?CAP>([^<]*)<'), '')), ''),
        'comune',         nullif(btrim(coalesce(substring(v_block from '<(?:[A-Za-z0-9]+:)?Comune>([^<]*)<'), '')), ''),
        'provincia',      nullif(btrim(coalesce(substring(v_block from '<(?:[A-Za-z0-9]+:)?Provincia>([^<]*)<'), '')), ''),
        'nazione',        nullif(btrim(coalesce(substring(v_block from '<(?:[A-Za-z0-9]+:)?Nazione>([^<]*)<'), '')), '')
      ));
    END IF;
    v_pay  := substring(v_doc from '<[^>]*DatiPagamento[^>]*>(.*?)</[^>]*DatiPagamento[^>]*>');
    v_iban := upper(regexp_replace(coalesce(substring(coalesce(v_pay, v_doc) from '<(?:[A-Za-z0-9]+:)?IBAN>([^<]*)<'), ''), '\s', '', 'g'));
    v_ist  := nullif(btrim(coalesce(substring(coalesce(v_pay, v_doc) from '<(?:[A-Za-z0-9]+:)?IstitutoFinanziario>([^<]*)<'), '')), '');
  END IF;

  -- L'IBAN entra in anagrafica solo se ha la forma di un IBAN.
  IF v_iban IS NOT NULL AND v_iban ~ '^[A-Z]{2}[0-9]{2}[0-9A-Z]{11,30}$' THEN
    v_out := v_out || jsonb_build_object('iban', v_iban);
    IF v_ist IS NOT NULL THEN
      v_out := v_out || jsonb_build_object('istituto', v_ist);
    END IF;
  END IF;

  RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.fn_invoice_cedente_profile(text) IS
  'Dati anagrafici del CedentePrestatore (codice fiscale, sede, regime fiscale) e IBAN/istituto del primo dettaglio di pagamento, letti dal JSON del bridge A-Cube o dall''XML puro. Ritorna un jsonb con le sole chiavi trovate.';

-- ── 3. il profilo del fornitore ricavato dalla fattura ───────────────────────
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
  IF s.payment_base IS NULL AND s.prima_scadenza_gg IS NULL AND s.numero_rate IS NULL
     AND coalesce(n, 0) >= 1 AND p_invoice_date IS NOT NULL THEN
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
  IF s.default_payment_method IS NULL AND coalesce(v_mets[1], '') <> '' THEN
    v_method := public.fn_sdi_mp_to_payment_method(v_mets[1], NULL);
  END IF;

  -- (c) CATEGORIA dalle righe della fattura (stessa logica della 200).
  IF s.default_cost_category_id IS NULL THEN
    v_cat := public.fn_categorize_from_lines(p_company_id, p_doc);
  END IF;

  -- quali campi sta compilando davvero questa chiamata
  IF s.codice_fiscale IS NULL AND v_prof ? 'codice_fiscale' THEN v_fields := array_append(v_fields, 'codice_fiscale'); END IF;
  IF s.regime_fiscale IS NULL AND v_prof ? 'regime_fiscale' THEN v_fields := array_append(v_fields, 'regime_fiscale'); END IF;
  IF s.indirizzo      IS NULL AND v_prof ? 'indirizzo'      THEN v_fields := array_append(v_fields, 'indirizzo'); END IF;
  IF s.cap            IS NULL AND v_prof ? 'cap'            THEN v_fields := array_append(v_fields, 'cap'); END IF;
  IF s.citta          IS NULL AND v_prof ? 'comune'         THEN v_fields := array_append(v_fields, 'citta'); END IF;
  IF s.provincia      IS NULL AND v_prof ? 'provincia'      THEN v_fields := array_append(v_fields, 'provincia'); END IF;
  IF nullif(s.iban, '') IS NULL AND v_prof ? 'iban'         THEN v_fields := array_append(v_fields, 'iban'); END IF;
  IF v_base   IS NOT NULL THEN v_fields := array_append(v_fields, 'piano_pagamento'); END IF;
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
    payment_base       = coalesce(payment_base,       v_base),
    prima_scadenza_gg  = coalesce(prima_scadenza_gg,  v_prima),
    numero_rate        = coalesce(numero_rate,        v_nrate),
    default_payment_method = coalesce(default_payment_method, v_method),
    payment_method         = CASE WHEN default_payment_method IS NULL AND v_method IS NOT NULL
                                  THEN v_method::text ELSE payment_method END,
    default_cost_category_id = coalesce(default_cost_category_id, v_cat),
    profile_from_invoice_id     = coalesce(p_invoice_id, profile_from_invoice_id),
    profile_from_invoice_at     = now(),
    profile_from_invoice_fields = (
      SELECT array_agg(DISTINCT f) FROM unnest(coalesce(profile_from_invoice_fields, ARRAY[]::text[]) || v_fields) f
    ),
    updated_at = now()
  WHERE id = p_supplier_id;

  RETURN v_fields;
END;
$function$;

COMMENT ON FUNCTION public.fn_supplier_profile_from_invoice(uuid, uuid, text, date, uuid) IS
  'Compila il fornitore leggendo la fattura: anagrafica del cedente, IBAN, piano di pagamento dalle scadenze dichiarate, metodo dal codice MP, categoria dalle righe. Tocca SOLO i campi vuoti, mai un valore inserito a mano. Ritorna l''elenco dei campi compilati.';

REVOKE ALL ON FUNCTION public.fn_supplier_profile_from_invoice(uuid, uuid, text, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_supplier_profile_from_invoice(uuid, uuid, text, date, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_supplier_profile_from_invoice(uuid, uuid, text, date, uuid) TO authenticated, service_role;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. IL BRIDGE A-CUBE: il fornitore nuovo nasce configurato
-- ═════════════════════════════════════════════════════════════════════════════
-- Rispetto alla versione 176 cambiano tre punti, il resto e' identico riga per riga:
--   (i)   la fattura elettronica viene registrata PRIMA del fornitore, per poter dire
--         da quale documento arriva il profilo;
--   (ii)  il fornitore nuovo nasce col metodo DICHIARATO in fattura (MP) invece del
--         'bonifico_ordinario' d'ufficio; se la fattura non lo dice resta il bonifico;
--   (iii) subito dopo passa da fn_supplier_profile_from_invoice, e solo allora si
--         rileggono piano, banca e metodo per generare le rate.
BEGIN;

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
    v_new_method := public.fn_sdi_mp_to_payment_method(v_mets[1], null);
    insert into public.suppliers (id, company_id, name, ragione_sociale, vat_number, partita_iva, nazione, source, is_active, payment_terms, payment_method, default_payment_method)
    values (gen_random_uuid(), v_company_id, v_name, v_name, NEW.sender_vat, NEW.sender_vat, coalesce(NEW.sender_country,'IT'), 'acube_sdi', true, 30,
            coalesce(v_new_method::text, 'bonifico_ordinario'), v_new_method)
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

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. RECUPERO DEI FORNITORI GIA' A SISTEMA
-- ═════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_backfill_supplier_profiles(p_max_invoices integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_company uuid;
  v_role    text;
  v_touched integer := 0;
  v_fields  integer := 0;
  r RECORD;
  e RECORD;
  v_res text[];
BEGIN
  SELECT company_id, role INTO v_company, v_role
  FROM public.user_profiles WHERE id = auth.uid();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Company non determinata per l''utente corrente';
  END IF;
  IF COALESCE(v_role, '') NOT IN ('super_advisor', 'contabile') THEN
    RAISE EXCEPTION 'Non autorizzato: serve il ruolo contabile o super_advisor';
  END IF;

  FOR r IN
    SELECT s.id, s.company_id, coalesce(s.partita_iva, s.vat_number) AS piva
      FROM public.suppliers s
     WHERE s.company_id = v_company
       AND coalesce(s.is_deleted, false) = false
       AND coalesce(s.partita_iva, s.vat_number) IS NOT NULL
       AND (s.codice_fiscale IS NULL OR s.indirizzo IS NULL OR nullif(s.iban, '') IS NULL
            OR s.regime_fiscale IS NULL OR s.payment_base IS NULL OR s.default_cost_category_id IS NULL)
  LOOP
    FOR e IN
      SELECT ei.id, ei.xml_content, ei.invoice_date
        FROM public.electronic_invoices ei
       WHERE ei.company_id = r.company_id
         AND ei.supplier_vat = r.piva
         AND ei.xml_content IS NOT NULL
       ORDER BY ei.invoice_date DESC NULLS LAST
       LIMIT greatest(coalesce(p_max_invoices, 5), 1)
    LOOP
      v_res := public.fn_supplier_profile_from_invoice(r.id, r.company_id, e.xml_content, e.invoice_date, e.id);
      IF array_length(v_res, 1) IS NOT NULL THEN
        v_fields := v_fields + array_length(v_res, 1);
      END IF;
    END LOOP;
    v_touched := v_touched + 1;
  END LOOP;

  RETURN jsonb_build_object('fornitori_esaminati', v_touched, 'campi_compilati', v_fields,
                            'company_id', v_company, 'run_at', now());
END;
$function$;

COMMENT ON FUNCTION public.rpc_backfill_supplier_profiles(integer) IS
  'Ripassa i fornitori con campi vuoti e li compila dalle loro fatture elettroniche (dalla piu' || chr(39) || 'recente). Idempotente: riempie solo i buchi, non sovrascrive mai un dato inserito a mano.';

REVOKE ALL ON FUNCTION public.rpc_backfill_supplier_profiles(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_backfill_supplier_profiles(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_backfill_supplier_profiles(integer) TO authenticated, service_role;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. BACKFILL UNA TANTUM sui fornitori gia' a sistema (NZ + Made + Zago)
-- ═════════════════════════════════════════════════════════════════════════════
-- Backup completo della tabella PRIMA di toccarla (regola no data loss), poi
-- ripassata dei fornitori con campi vuoti sulle loro ultime 5 fatture. Solo
-- UPDATE di campi NULL: nessun valore esistente viene sovrascritto.
BEGIN;

CREATE TABLE IF NOT EXISTS public.suppliers_backup_profilo_20260910 AS
  SELECT * FROM public.suppliers;
ALTER TABLE public.suppliers_backup_profilo_20260910 ENABLE ROW LEVEL SECURITY;

DO $backfill$
DECLARE
  r RECORD; e RECORD; v_res text[]; v_n integer := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.company_id, coalesce(s.partita_iva, s.vat_number) AS piva
      FROM public.suppliers s
     WHERE coalesce(s.is_deleted, false) = false
       AND coalesce(s.partita_iva, s.vat_number) IS NOT NULL
       AND (s.codice_fiscale IS NULL OR s.indirizzo IS NULL OR nullif(s.iban, '') IS NULL
            OR s.regime_fiscale IS NULL OR s.payment_base IS NULL OR s.default_cost_category_id IS NULL)
  LOOP
    FOR e IN
      SELECT ei.id, ei.xml_content, ei.invoice_date
        FROM public.electronic_invoices ei
       WHERE ei.company_id = r.company_id
         AND ei.supplier_vat = r.piva
         AND ei.xml_content IS NOT NULL
       ORDER BY ei.invoice_date DESC NULLS LAST
       LIMIT 5
    LOOP
      v_res := public.fn_supplier_profile_from_invoice(r.id, r.company_id, e.xml_content, e.invoice_date, e.id);
      IF array_length(v_res, 1) IS NOT NULL THEN v_n := v_n + array_length(v_res, 1); END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'backfill profili fornitore: % campi compilati', v_n;
END;
$backfill$;

COMMIT;
