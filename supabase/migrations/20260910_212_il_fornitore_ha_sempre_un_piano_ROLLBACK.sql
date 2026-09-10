-- ROLLBACK 20260910_212 — la funzione torna a NON scrivere la regola standard: se la
-- fattura non porta i termini il piano resta vuoto, e la segnalazione «fornitore non
-- riconosciuto» torna a comparire per quei fornitori.
--
-- I piani standard gia' scritti NON vengono rimossi da questo file: cancellarli
-- riporterebbe indietro anche fornitori che nel frattempo qualcuno puo' aver confermato.
-- Per toglierli davvero, e solo dopo aver controllato uno per uno:
--   UPDATE public.suppliers
--      SET payment_base = NULL, prima_scadenza_gg = NULL, numero_rate = NULL,
--          profile_from_invoice_fields = array_remove(profile_from_invoice_fields, 'piano_standard')
--    WHERE profile_from_invoice_fields @> ARRAY['piano_standard'];

BEGIN;

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

COMMIT;
