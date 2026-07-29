-- 099 — Dettaglio "cosa scarico" anche per le FATTURE ATTIVE (vendite)
--
-- PERCHÉ
-- La migration 092 ha introdotto public.sync_run_details e lo ha cablato su
-- banche + fatture_passive; la 097 lo ha esteso al cassetto_fiscale. La funzione
-- delle fatture ATTIVE (migration 091, acube_sdi_sync_outbound_production) è
-- rimasta indietro: scrive la riga riepilogo in sync_runs (items_downloaded) ma
-- NON una riga di dettaglio per fattura. Risultato: nel Report Sincronizzazioni,
-- espandendo una run "fatture_attive" con documenti scaricati, compare "Nessun
-- dettaglio registrato" anche se le fatture sono state scaricate e propagate in
-- active_invoices. Non è una regressione: quel dettaglio non è mai stato scritto
-- per questo feed.
--
-- COSA FA
--   1. CREATE OR REPLACE della funzione outbound (attive): aggiunge l'accumulo
--      del dettaglio — una riga per fattura EMESSA, controparte = CLIENTE
--      (recipient) — e la insert in sync_run_details dopo la insert della run,
--      speculare alla gemella passive (092). Unica differenza rispetto alla
--      passive: la controparte è il destinatario (cliente), non il mittente.
--   2. BACKFILL storico: ricostruisce le righe di dettaglio per le run già
--      eseguite, agganciando ogni fattura attiva alla sua run tramite
--      acube_sdi_invoices.created_at = sync_runs.run_at. L'uguaglianza è esatta
--      perché entrambe le colonne sono valorizzate con now() (transaction_timestamp)
--      nella STESSA transazione della run. Idempotente (NOT EXISTS) e additivo.
--
-- ADDITIVA e NON distruttiva. Nessun DROP, nessuna perdita dati.
-- ⚠️ PARITÀ TENANT: applicare su NZ + Made + Zago (3 project_id).

-- ─── 1. Funzione outbound (attive) con logging di dettaglio ───────────────
CREATE OR REPLACE FUNCTION public.acube_sdi_sync_outbound_production(
  p_stage text DEFAULT 'production',
  p_origine text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_origine public.sync_origin;
  v_role text;
  v_creds record;
  v_login_url text;
  v_base_url text;
  v_login http_response;
  v_jwt text;
  v_company_id uuid;
  v_company_vat text;
  v_snd_vat text;
  v_page int := 1;
  v_max_pages int := 60;
  v_resp http_response;
  v_xmlresp http_response;
  v_xml text;
  v_arr jsonb;
  v_len int;
  v_item jsonb;
  v_uuid uuid;
  v_payload jsonb;
  v_doc jsonb;
  v_inv_num text;
  v_inv_date date;
  v_total numeric;
  v_currency text;
  v_new_this_page int;
  v_inserted int := 0;
  v_found int := 0;
  v_min_date date;
  v_max_date date;
  v_status public.sync_status;
  v_errmsg text := NULL;
  -- logging dettaglio per fattura (una riga per vendita scaricata)
  v_run_id uuid;
  v_details jsonb := '[]'::jsonb;
BEGIN
  SELECT id, vat_number INTO v_company_id, v_company_vat FROM public.companies LIMIT 1;

  IF p_origine IS NOT NULL THEN
    v_origine := p_origine::public.sync_origin;
  ELSIF auth.uid() IS NOT NULL THEN
    v_origine := 'manuale';
  ELSE
    v_origine := 'auto_cron';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    v_role := public.get_my_role()::text;
    IF v_role IS NULL OR v_role NOT IN ('super_advisor','contabile','cfo') THEN
      RAISE EXCEPTION 'Ruolo % non autorizzato alla sincronizzazione fatture', COALESCE(v_role,'(nessuno)');
    END IF;
  END IF;

  IF p_stage NOT IN ('production','sandbox') THEN
    RAISE EXCEPTION 'Stage non valido: %', p_stage;
  END IF;
  IF p_stage = 'production' THEN
    v_login_url := 'https://common.api.acubeapi.com/login';
    v_base_url  := 'https://api.acubeapi.com';
  ELSE
    v_login_url := 'https://common-sandbox.api.acubeapi.com/login';
    v_base_url  := 'https://api-sandbox.acubeapi.com';
  END IF;

  PERFORM set_config('statement_timeout','170000', true);
  PERFORM http_set_curlopt('CURLOPT_TIMEOUT','30');

  SELECT email, password INTO v_creds FROM public.get_acube_credentials(p_stage) LIMIT 1;
  SELECT * INTO v_login FROM http((
    'POST', v_login_url,
    ARRAY[http_header('Accept','application/json')],
    'application/json',
    json_build_object('email', v_creds.email, 'password', v_creds.password)::text
  )::http_request);
  v_jwt := (v_login.content::jsonb)->>'token';

  IF v_jwt IS NULL THEN
    v_errmsg := 'login_failed: ' || COALESCE(LEFT(v_login.content,200),'no body');
    INSERT INTO public.sync_runs(company_id, feed, origine, status, items_downloaded, error_message, duration_ms, run_at)
    VALUES (v_company_id, 'fatture_attive', v_origine, 'errore', 0, v_errmsg,
            (extract(epoch from clock_timestamp()-v_started)*1000)::int, now());
    RETURN jsonb_build_object('ok',false,'error',v_errmsg,'inserted',0);
  END IF;

  LOOP
    EXIT WHEN v_page > v_max_pages;
    SELECT * INTO v_resp FROM http((
      'GET', format('%s/invoices?direction=out&page=%s', v_base_url, v_page),
      ARRAY[http_header('Authorization','Bearer '||v_jwt), http_header('Accept','application/json')],
      NULL, NULL
    )::http_request);

    IF v_resp.status <> 200 THEN
      v_errmsg := concat_ws(' | ', v_errmsg, format('page %s HTTP %s: %s', v_page, v_resp.status, LEFT(v_resp.content,150)));
      EXIT;
    END IF;

    v_arr := v_resp.content::jsonb;
    IF jsonb_typeof(v_arr) <> 'array' THEN
      v_arr := COALESCE(v_arr->'hydra:member', v_arr->'member', v_arr->'data', '[]'::jsonb);
    END IF;
    v_len := jsonb_array_length(v_arr);
    EXIT WHEN v_len = 0;
    v_found := v_found + v_len;
    v_new_this_page := 0;

    FOR v_item IN SELECT * FROM jsonb_array_elements(v_arr) LOOP
      v_uuid := nullif(COALESCE(v_item->>'uuid', v_item->>'id'),'')::uuid;
      IF v_uuid IS NULL THEN CONTINUE; END IF;

      -- Guardia tenant: per le ATTIVE il mittente (cedente) è la nostra azienda.
      v_snd_vat := v_item->'sender'->>'business_vat_number_code';
      IF v_company_vat IS NOT NULL AND v_snd_vat IS NOT NULL
         AND regexp_replace(v_snd_vat,'\D','','g') <> regexp_replace(v_company_vat,'\D','','g') THEN
        CONTINUE;
      END IF;

      -- Idempotenza: già emesse dal form o già scaricate.
      IF EXISTS (SELECT 1 FROM public.acube_sdi_invoices WHERE acube_uuid = v_uuid) THEN
        CONTINUE;
      END IF;

      BEGIN
        v_payload := (v_item->>'payload')::jsonb;
      EXCEPTION WHEN OTHERS THEN v_payload := NULL; END;
      v_doc := v_payload #> '{fattura_elettronica_body,0,dati_generali,dati_generali_documento}';
      v_inv_num  := v_doc->>'numero';
      v_inv_date := nullif(v_doc->>'data','')::date;
      v_total    := nullif(v_doc->>'importo_totale_documento','')::numeric;
      v_currency := COALESCE(v_doc->>'divisa','EUR');

      v_xml := NULL;
      BEGIN
        SELECT * INTO v_xmlresp FROM http((
          'GET', format('%s/invoices/%s', v_base_url, v_uuid),
          ARRAY[http_header('Authorization','Bearer '||v_jwt), http_header('Accept','application/xml')],
          NULL, NULL
        )::http_request);
        IF v_xmlresp.status = 200 THEN
          v_xml := ltrim(v_xmlresp.content, chr(65279) || E' \t\r\n');
          IF left(v_xml,1) <> '<' THEN v_xml := NULL; END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN v_xml := NULL; END;

      INSERT INTO public.acube_sdi_invoices (
        acube_uuid, business_fiscal_id, direction, type, marking,
        sdi_file_id, sdi_file_name, transmission_format, document_type,
        invoice_number, invoice_date, currency, total_amount, to_pa,
        sender_vat, sender_country, sender_name, recipient_vat, recipient_name, recipient_code,
        payload, xml_content, acube_created_at
      ) VALUES (
        v_uuid,
        v_item->'sender'->>'business_vat_number_code',
        'active',
        nullif(v_item->>'type','')::smallint,
        COALESCE(v_item->>'marking','sent'),
        v_item->>'sdi_file_id',
        v_item->>'sdi_file_name',
        v_item->>'transmission_format',
        COALESCE(v_item->>'document_type', v_doc->>'tipo_documento'),
        v_inv_num, v_inv_date, v_currency, v_total,
        COALESCE((v_item->>'to_pa')::boolean,false),
        v_item->'sender'->>'business_vat_number_code',
        COALESCE(v_item->'sender'->>'business_vat_number_country','IT'),
        v_item->'sender'->>'business_name',
        v_item->'recipient'->>'business_vat_number_code',
        v_item->'recipient'->>'business_name',
        v_item->'recipient'->>'recipient_code',
        v_payload, v_xml,
        nullif(v_item->>'created_at','')::timestamptz
      );

      v_inserted := v_inserted + 1;
      v_new_this_page := v_new_this_page + 1;
      IF v_inv_date IS NOT NULL THEN
        v_min_date := least(COALESCE(v_min_date, v_inv_date), v_inv_date);
        v_max_date := greatest(COALESCE(v_max_date, v_inv_date), v_inv_date);
      END IF;

      -- accumula il dettaglio di questa fattura (persistito dopo la insert della run).
      -- Controparte = CLIENTE (recipient): è la differenza rispetto alla passive.
      v_details := v_details || jsonb_build_object(
        'label',        COALESCE(NULLIF(v_inv_num,''), LEFT(v_uuid::text,8)),
        'reference',    v_uuid::text,
        'counterparty', v_item->'recipient'->>'business_name',
        'doc_date',     v_inv_date,
        'amount',       v_total,
        'currency',     v_currency
      );
    END LOOP;

    EXIT WHEN v_new_this_page = 0;
    EXIT WHEN v_len < 30;
    v_page := v_page + 1;
  END LOOP;

  v_status := CASE
    WHEN v_errmsg IS NOT NULL AND v_inserted > 0 THEN 'parziale'
    WHEN v_errmsg IS NOT NULL THEN 'errore'
    ELSE 'ok'
  END::public.sync_status;

  INSERT INTO public.sync_runs(company_id, feed, origine, period_from, period_to, status, items_downloaded, error_message, duration_ms, run_at)
  VALUES (v_company_id, 'fatture_attive', v_origine, v_min_date, v_max_date, v_status, v_inserted,
          CASE WHEN v_errmsg IS NOT NULL THEN LEFT(v_errmsg,4000) ELSE NULL END,
          (extract(epoch from clock_timestamp()-v_started)*1000)::int, now())
  RETURNING id INTO v_run_id;

  -- una riga di dettaglio per fattura emessa scaricata
  INSERT INTO public.sync_run_details
    (sync_run_id, company_id, feed, detail_type, label, reference, counterparty, doc_date, amount, currency)
  SELECT v_run_id, v_company_id, 'fatture_attive', 'fattura',
         d->>'label', d->>'reference', d->>'counterparty',
         NULLIF(d->>'doc_date','')::date,
         NULLIF(d->>'amount','')::numeric,
         d->>'currency'
  FROM jsonb_array_elements(v_details) AS d;

  RETURN jsonb_build_object('ok', v_errmsg IS NULL, 'inserted', v_inserted, 'found', v_found,
                            'pages', v_page, 'status', v_status, 'error', v_errmsg);
EXCEPTION WHEN OTHERS THEN
  IF v_company_id IS NOT NULL THEN
    INSERT INTO public.sync_runs(company_id, feed, origine, status, items_downloaded, error_message, duration_ms, run_at)
    VALUES (v_company_id, 'fatture_attive', COALESCE(v_origine,'auto_cron'), 'errore', v_inserted, LEFT(SQLERRM,4000),
            (extract(epoch from clock_timestamp()-v_started)*1000)::int, now());
  END IF;
  RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.acube_sdi_sync_outbound_production(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acube_sdi_sync_outbound_production(text,text) TO authenticated, service_role;

-- ─── 2. Backfill storico: ricostruisce il dettaglio delle run già eseguite ─
-- Aggancio esatto per timestamp (created_at = run_at, stessa transazione).
-- Le fatture attive emesse dal form (acube-sdi-send-invoice) non hanno una run
-- corrispondente e restano quindi escluse — corretto, non facevano parte di un
-- download automatico. Idempotente: non tocca le run che hanno già un dettaglio.
INSERT INTO public.sync_run_details
  (sync_run_id, company_id, feed, detail_type, label, reference, counterparty, doc_date, amount, currency)
SELECT r.id, r.company_id, 'fatture_attive', 'fattura',
       COALESCE(NULLIF(i.invoice_number,''), LEFT(i.acube_uuid::text,8)),
       i.acube_uuid::text,
       i.recipient_name,
       i.invoice_date,
       i.total_amount,
       COALESCE(i.currency,'EUR')
FROM public.sync_runs r
JOIN public.acube_sdi_invoices i
  ON i.direction = 'active'
 AND i.created_at = r.run_at
WHERE r.feed = 'fatture_attive'
  AND r.items_downloaded > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.sync_run_details d WHERE d.sync_run_id = r.id
  );
