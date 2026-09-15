-- 20260910_212 — Il fornitore ha SEMPRE un piano: dalla fattura se c'e', standard altrimenti
--
-- PERCHE' (Patrizio, 10/09/2026): «se arriva un fornitore nuovo e' perche' A-Cube ha
-- scaricato una fattura, e dentro la fattura ci sono gia' i dati per creare il fornitore,
-- e se c'e' una fattura c'e' una modalita' di pagamento».
--
-- Il principio e' giusto: il fornitore non deve finire in una lista da compilare a mano.
-- Il limite pero' non e' nel codice, e' nei documenti. Misurato su NZ: delle 458 fatture
-- degli ultimi 90 giorni solo 152 portano il blocco DatiPagamento — che nella fattura
-- elettronica e' FACOLTATIVO — e delle 306 che non lo portano appena 5 scrivono qualcosa
-- sul pagamento nel testo libero. Bar, distributori, negozi e ristoranti non lo compilano.
--
-- COSA CAMBIA. Quando il profilo non trova i termini in fattura non lascia piu' il piano
-- vuoto (che poi diventava la riga rossa «fornitore non riconosciuto»): scrive la REGOLA
-- STANDARD, la stessa che il sistema applica gia' nei calcoli come ripiego, e la marca in
-- `profile_from_invoice_fields` come 'piano_standard' invece di 'piano_pagamento':
--   · metodo carta o contanti -> data fattura, 0 giorni, 1 rata (si paga sul posto);
--   · tutti gli altri         -> fine mese, 30 giorni, 1 rata.
--
-- E soprattutto: un piano marcato standard NON e' una scelta umana, quindi la prima fattura
-- che porta scadenze vere lo SOSTITUISCE (e il marcatore diventa 'piano_pagamento'). Un
-- piano scritto a mano resta invece intoccabile, come prima.
--
-- Il piano si considera mancante quando manca la BASE, non quando sono vuoti tutti e tre i
-- campi: Adobe aveva numero_rate = 1 senza base ne' giorni, un piano a meta' e inutilizzabile
-- che con la vecchia condizione sarebbe rimasto tale.
--
-- EFFETTO: `payment_base` non e' mai NULL per un fornitore nato da una fattura, quindi la
-- segnalazione «fornitore non riconosciuto» non nasce piu' per costruzione.
-- Esito NZ dopo il backfill: 0 fornitori auto-creati senza piano (erano 14), 12 col piano
-- standard marcato, gli unici due rimasti senza sono creati a mano e senza fatture
-- elettroniche (Tari Valdichiana e Westi Srl), dove la scelta e' di chi li ha inseriti.
-- Rollback in _ROLLBACK.sql

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
    v_metodo := coalesce(s.default_payment_method::text, s.payment_method,
                         public.fn_sdi_mp_to_payment_method(v_mets[1], NULL)::text, '');
    IF v_metodo IN ('contanti', 'carta_credito', 'carta_debito') THEN
      v_base := 'data_fattura'; v_prima := coalesce(s.prima_scadenza_gg, 0);
    ELSE
      v_base := 'fine_mese'; v_prima := coalesce(s.prima_scadenza_gg, 30);
    END IF;
    v_nrate := coalesce(s.numero_rate, 1);
    v_std := true;
  END IF;

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

COMMENT ON FUNCTION public.fn_supplier_profile_from_invoice(uuid, uuid, text, date, uuid) IS
  'Compila il fornitore leggendo la fattura: anagrafica del cedente, IBAN, piano di pagamento dalle scadenze dichiarate, metodo dal codice MP, categoria dalle righe. Se la fattura non porta i termini scrive la REGOLA STANDARD (fine mese 30 gg, o pagamento immediato per carta e contanti) marcandola piano_standard, che la prima fattura con termini veri sostituisce. Il piano si considera mancante quando manca la base. Gli altri campi si riempiono solo se vuoti: un dato inserito a mano non viene mai sovrascritto.';

-- Ripassata dei fornitori rimasti senza piano: prendono quello della loro ultima fattura,
-- o la regola standard se la fattura non dice niente.
DO $backfill$
DECLARE r RECORD; e RECORD; v text[];
BEGIN
  FOR r IN
    SELECT s.id, s.company_id, coalesce(s.partita_iva, s.vat_number) piva
      FROM public.suppliers s
     WHERE coalesce(s.is_deleted,false)=false AND s.payment_base IS NULL
       AND coalesce(s.partita_iva, s.vat_number) IS NOT NULL
  LOOP
    SELECT ei.id, ei.xml_content, ei.invoice_date INTO e
      FROM public.electronic_invoices ei
     WHERE ei.company_id = r.company_id AND ei.supplier_vat = r.piva AND ei.xml_content IS NOT NULL
     ORDER BY ei.invoice_date DESC NULLS LAST LIMIT 1;
    IF FOUND THEN
      v := public.fn_supplier_profile_from_invoice(r.id, r.company_id, e.xml_content, e.invoice_date, e.id);
    END IF;
  END LOOP;
END;
$backfill$;

-- VERIFICA (deve tornare 0): fornitori nati da una fattura e rimasti senza piano
-- SELECT count(*) FROM public.suppliers
--  WHERE coalesce(is_deleted,false)=false AND source='acube_sdi' AND payment_base IS NULL;
