-- 092 — sync_run_details: dettaglio "cosa scarico" per ogni sincronizzazione
--
-- PERCHÉ: sync_runs tiene UNA riga per run con un totale aggregato
-- (items_downloaded). L'utente vuole tracciare SEMPRE il dettaglio di cosa
-- viene scaricato dagli aggiornamenti esterni A-Cube:
--   • banche         → una riga per ciascuna banca (conti, movimenti scaricati, saldo)
--   • fatture_passive → una riga per ciascuna fattura scaricata (numero, fornitore, data, importo)
--
-- Il breakdown per banca era GIÀ calcolato dentro acube_ob_sync_all_production
-- (RETURN QUERY per fiscal_id) ma veniva perso: qui lo persistiamo. Per le
-- fatture aggiungiamo una riga di dettaglio per ogni documento inserito.
--
-- ADDITIVA e NON distruttiva: nuova tabella + CREATE OR REPLACE delle funzioni
-- di sync (basate sulle ultime versioni: OB=073, inbound=076, log manuale=077),
-- con la SOLA aggiunta del logging di dettaglio. Nessun DROP di dati.
--
-- RLS: lettura company-scoped (get_my_company_id). Nessuna policy di scrittura:
-- gli unici writer sono funzioni SECURITY DEFINER (owner postgres → bypassano
-- RLS) e le edge function via service_role.
--
-- ⚠️ PARITÀ TENANT: applicare A MANO su NZ + Made + Zago (3 project_id).

-- ─── TABELLA ─────────────────────────────────────────────────────────────
create table if not exists public.sync_run_details (
  id            uuid primary key default gen_random_uuid(),
  sync_run_id   uuid not null references public.sync_runs(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  feed          public.sync_feed not null,
  detail_type   text not null,                    -- 'banca' | 'fattura'
  label         text not null,                    -- nome banca / numero fattura
  reference     text,                             -- fiscal_id o IBAN / acube_uuid
  counterparty  text,                             -- fornitore (fatture)
  doc_date      date,                             -- data documento (fatture)
  items_count   integer not null default 0,       -- movimenti scaricati (banche)
  amount        numeric,                          -- saldo (banche) / importo (fattura)
  currency      text,
  error_message text,
  extra         jsonb,
  created_at    timestamptz not null default now()
);

comment on table public.sync_run_details is
  'Dettaglio per singola fonte/documento di una run di sincronizzazione. banche → una riga per banca; fatture_passive → una riga per fattura scaricata.';

create index if not exists idx_sync_run_details_run   on public.sync_run_details (sync_run_id);
create index if not exists idx_sync_run_details_company on public.sync_run_details (company_id, created_at desc);

-- ─── RLS ─────────────────────────────────────────────────────────────────
alter table public.sync_run_details enable row level security;

do $$ begin
  create policy sync_run_details_select_by_company on public.sync_run_details
    for select using (company_id = public.get_my_company_id());
exception when duplicate_object then null; end $$;

-- ─── 1. OB banche: persiste il breakdown per banca ───────────────────────
CREATE OR REPLACE FUNCTION public.acube_ob_sync_all_production()
 RETURNS TABLE(fiscal_id text, accounts integer, transactions integer, error text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_creds RECORD;
  v_jwt TEXT;
  v_login_resp http_response;
  v_acc_resp http_response;
  v_tx_resp http_response;
  v_br RECORD;
  v_acc JSONB;
  v_company_id UUID;
  v_acc_count INT;
  v_tx_count INT;
  v_err TEXT;
  v_inserted INT;
  -- logging sync_runs
  v_started TIMESTAMPTZ := clock_timestamp();
  v_tot_tx INT := 0;
  v_err_agg TEXT := NULL;
  -- logging dettaglio per banca
  v_run_id UUID;
  v_details JSONB := '[]'::jsonb;
  v_bank_balance NUMERIC;
BEGIN
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;

  SELECT email, password INTO v_creds FROM get_acube_credentials('production') LIMIT 1;
  SELECT * INTO v_login_resp FROM http(('POST',
    'https://common.api.acubeapi.com/login',
    ARRAY[http_header('Accept','application/json')],
    'application/json',
    json_build_object('email', v_creds.email, 'password', v_creds.password)::text
  )::http_request);
  v_jwt := (v_login_resp.content::jsonb)->>'token';
  IF v_jwt IS NULL THEN
    INSERT INTO public.sync_runs(company_id, feed, origine, status, items_downloaded, error_message, duration_ms, run_at)
    VALUES (v_company_id, 'banche', 'auto_cron', 'errore', 0,
            'login_failed: ' || COALESCE(LEFT(v_login_resp.content,200),'no body'),
            (extract(epoch from clock_timestamp()-v_started)*1000)::int, now());
    RETURN QUERY SELECT 'LOGIN'::text, 0, 0, 'login_failed: ' || COALESCE(LEFT(v_login_resp.content,200), 'no body');
    RETURN;
  END IF;

  FOR v_br IN
    SELECT abr.uuid AS br_uuid, abr.fiscal_id, abr.business_name
    FROM acube_business_registries abr
    WHERE abr.stage = 'production' AND abr.enabled = true
  LOOP
    v_acc_count := 0; v_tx_count := 0; v_err := NULL; v_bank_balance := NULL;

    BEGIN
      SELECT * INTO v_acc_resp FROM http((
        'GET',
        format('https://ob.api.acubeapi.com/business-registry/%s/accounts', v_br.fiscal_id),
        ARRAY[http_header('Authorization','Bearer '||v_jwt), http_header('Accept','application/json')],
        NULL, NULL
      )::http_request);

      IF v_acc_resp.status = 200 THEN
        FOR v_acc IN SELECT acc FROM jsonb_array_elements(v_acc_resp.content::jsonb) AS acc(acc)
          WHERE (acc->>'enabled')::boolean LOOP

          INSERT INTO acube_accounts (uuid, business_registry_uuid, account_id, account_number, iban, bban, swift,
            name, nature, provider_name, provider_country, currency_code, balance, enabled, connection_id, consent_expires_at, extra)
          VALUES (
            (v_acc->>'uuid')::uuid, v_br.br_uuid, v_acc->>'accountId', v_acc->>'accountNumber', v_acc->>'iban', v_acc->>'bban', v_acc->>'swift',
            COALESCE(v_acc->>'name', v_acc->>'iban'), v_acc->>'nature', v_acc->>'providerName', 'IT',
            v_acc->>'currencyCode', (v_acc->>'balance')::numeric, (v_acc->>'enabled')::boolean,
            v_acc->>'connectionId', (v_acc->>'consentExpiresAt')::timestamptz, v_acc
          )
          ON CONFLICT (uuid) DO UPDATE SET balance=EXCLUDED.balance, enabled=EXCLUDED.enabled, updated_at=now();

          UPDATE bank_accounts SET
            current_balance = (v_acc->>'balance')::numeric,
            balance_updated_at = now(),
            is_active = (v_acc->>'enabled')::boolean,
            updated_at = now()
          WHERE acube_account_uuid = (v_acc->>'uuid')::uuid;

          IF NOT FOUND THEN
            INSERT INTO bank_accounts (company_id, bank_name, iban, account_name, account_type, currency,
              is_active, is_manual, current_balance, balance_updated_at, acube_account_uuid)
            VALUES (v_company_id,
              COALESCE(v_acc->>'providerName', 'Banca'),
              v_acc->>'iban',
              COALESCE(v_acc->>'name', v_acc->>'iban'),
              'conto_corrente', v_acc->>'currencyCode',
              true, false,
              (v_acc->>'balance')::numeric, now(),
              (v_acc->>'uuid')::uuid);
          END IF;

          v_acc_count := v_acc_count + 1;
          v_bank_balance := COALESCE(v_bank_balance, 0) + COALESCE((v_acc->>'balance')::numeric, 0);

          SELECT * INTO v_tx_resp FROM http((
            'GET',
            format('https://ob.api.acubeapi.com/business-registry/%s/transactions?account=%s&itemsPerPage=100',
              v_br.fiscal_id, v_acc->>'uuid'),
            ARRAY[http_header('Authorization','Bearer '||v_jwt), http_header('Accept','application/json')],
            NULL, NULL
          )::http_request);

          IF v_tx_resp.status = 200 THEN
            INSERT INTO bank_transactions (
              company_id, bank_account_id, transaction_date, booking_date, value_date,
              amount, currency, description, status, source, acube_transaction_id, raw_data, is_reconciled,
              acube_dedup_hash
            )
            SELECT v_company_id, ba.id,
              (LEFT(x.t->>'madeOn',10))::date, (LEFT(x.t->>'madeOn',10))::date, (LEFT(x.t->>'madeOn',10))::date,
              (x.t->>'amount')::numeric, x.t->>'currencyCode', x.t->>'description',
              'booked', 'acube_ob', x.t->>'transactionId', x.t, false,
              public.bank_tx_canonical_hash_occ(
                ba.id, (LEFT(x.t->>'madeOn',10))::date, (x.t->>'amount')::numeric, x.t->>'description',
                (row_number() OVER (
                  PARTITION BY ba.id, LEFT(x.t->>'madeOn',10), x.t->>'amount', LEFT(COALESCE(x.t->>'description',''),40)
                  ORDER BY x.t->>'transactionId'))::int
              )
            FROM jsonb_array_elements(v_tx_resp.content::jsonb) AS x(t)
            JOIN bank_accounts ba ON ba.company_id = v_company_id
                                 AND ba.acube_account_uuid = (x.t->'account'->>'uuid')::uuid
            ON CONFLICT (acube_dedup_hash) WHERE acube_dedup_hash IS NOT NULL DO NOTHING;
            GET DIAGNOSTICS v_inserted = ROW_COUNT;
            v_tx_count := v_tx_count + v_inserted;
          END IF;
        END LOOP;
      ELSE
        v_err := format('accounts HTTP %s: %s', v_acc_resp.status, LEFT(v_acc_resp.content, 150));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;

    v_tot_tx := v_tot_tx + v_tx_count;
    IF v_err IS NOT NULL THEN
      v_err_agg := concat_ws(' | ', v_err_agg, v_br.fiscal_id || ': ' || v_err);
    END IF;

    -- accumula il dettaglio di questa banca (persistito dopo la insert della run)
    v_details := v_details || jsonb_build_object(
      'label',     COALESCE(NULLIF(v_br.business_name,''), v_br.fiscal_id),
      'reference', v_br.fiscal_id,
      'accounts',  v_acc_count,
      'items',     v_tx_count,
      'balance',   v_bank_balance,
      'error',     v_err
    );

    RETURN QUERY SELECT v_br.fiscal_id, v_acc_count, v_tx_count, v_err;
  END LOOP;

  INSERT INTO public.sync_runs(company_id, feed, origine, status, items_downloaded, error_message, duration_ms, run_at)
  VALUES (v_company_id, 'banche', 'auto_cron',
          CASE WHEN v_err_agg IS NOT NULL THEN 'parziale' ELSE 'ok' END::public.sync_status,
          v_tot_tx, CASE WHEN v_err_agg IS NOT NULL THEN LEFT(v_err_agg,4000) ELSE NULL END,
          (extract(epoch from clock_timestamp()-v_started)*1000)::int, now())
  RETURNING id INTO v_run_id;

  -- una riga di dettaglio per banca
  INSERT INTO public.sync_run_details
    (sync_run_id, company_id, feed, detail_type, label, reference, items_count, amount, error_message, extra)
  SELECT v_run_id, v_company_id, 'banche', 'banca',
         d->>'label', d->>'reference',
         COALESCE((d->>'items')::int, 0),
         NULLIF(d->>'balance','')::numeric,
         d->>'error',
         jsonb_build_object('accounts', COALESCE((d->>'accounts')::int, 0))
  FROM jsonb_array_elements(v_details) AS d;
END;
$function$;

-- ─── 2. Fatture passive: persiste una riga per fattura scaricata ─────────
CREATE OR REPLACE FUNCTION public.acube_sdi_sync_inbound_production(
  p_stage text DEFAULT 'production',
  p_origine text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
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
  v_rec_vat text;
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
  -- logging dettaglio per fattura
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
    VALUES (v_company_id, 'fatture_passive', v_origine, 'errore', 0, v_errmsg,
            (extract(epoch from clock_timestamp()-v_started)*1000)::int, now());
    RETURN jsonb_build_object('ok',false,'error',v_errmsg,'inserted',0);
  END IF;

  LOOP
    EXIT WHEN v_page > v_max_pages;
    SELECT * INTO v_resp FROM http((
      'GET', format('%s/invoices?direction=in&page=%s', v_base_url, v_page),
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

      v_rec_vat := v_item->'recipient'->>'business_vat_number_code';
      IF v_company_vat IS NOT NULL AND v_rec_vat IS NOT NULL
         AND regexp_replace(v_rec_vat,'\D','','g') <> regexp_replace(v_company_vat,'\D','','g') THEN
        CONTINUE;
      END IF;

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

      -- vero FatturaPA XML (Accept xml), con strip del BOM UTF-8 iniziale
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
        v_item->'recipient'->>'business_vat_number_code',
        'passive',
        nullif(v_item->>'type','')::smallint,
        COALESCE(v_item->>'marking','received'),
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

      -- accumula il dettaglio di questa fattura (persistito dopo la insert della run)
      v_details := v_details || jsonb_build_object(
        'label',        COALESCE(NULLIF(v_inv_num,''), LEFT(v_uuid::text,8)),
        'reference',    v_uuid::text,
        'counterparty', v_item->'sender'->>'business_name',
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
  VALUES (v_company_id, 'fatture_passive', v_origine, v_min_date, v_max_date, v_status, v_inserted,
          CASE WHEN v_errmsg IS NOT NULL THEN LEFT(v_errmsg,4000) ELSE NULL END,
          (extract(epoch from clock_timestamp()-v_started)*1000)::int, now())
  RETURNING id INTO v_run_id;

  -- una riga di dettaglio per fattura scaricata
  INSERT INTO public.sync_run_details
    (sync_run_id, company_id, feed, detail_type, label, reference, counterparty, doc_date, amount, currency)
  SELECT v_run_id, v_company_id, 'fatture_passive', 'fattura',
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
    VALUES (v_company_id, 'fatture_passive', COALESCE(v_origine,'auto_cron'), 'errore', v_inserted, LEFT(SQLERRM,4000),
            (extract(epoch from clock_timestamp()-v_started)*1000)::int, now());
  END IF;
  RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.acube_sdi_sync_inbound_production(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acube_sdi_sync_inbound_production(text,text) TO authenticated, service_role;

-- ─── 3. Sync manuale banche: accetta il dettaglio per banca ──────────────
-- Sostituisce la firma (int,int) con (int,int,jsonb). Il default su p_details
-- mantiene compatibili le chiamate esistenti {p_items, p_duration_ms}.
DROP FUNCTION IF EXISTS public.log_bank_sync_run(int, int);

CREATE OR REPLACE FUNCTION public.log_bank_sync_run(
  p_items int DEFAULT 0,
  p_duration_ms int DEFAULT NULL,
  p_details jsonb DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid := get_my_company_id();
  v_run_id uuid;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'Nessuna azienda per l''utente'; END IF;
  INSERT INTO public.sync_runs(company_id, feed, origine, status, items_downloaded, duration_ms, run_at)
  VALUES (v_company, 'banche', 'manuale', 'ok', COALESCE(p_items,0), p_duration_ms, now())
  RETURNING id INTO v_run_id;

  IF p_details IS NOT NULL AND jsonb_typeof(p_details) = 'array' THEN
    INSERT INTO public.sync_run_details
      (sync_run_id, company_id, feed, detail_type, label, reference, items_count, amount, error_message, extra)
    SELECT v_run_id, v_company, 'banche', 'banca',
           COALESCE(NULLIF(d->>'label',''), 'Banca'),
           d->>'reference',
           COALESCE((d->>'items')::int, 0),
           NULLIF(d->>'balance','')::numeric,
           d->>'error',
           jsonb_build_object('accounts', COALESCE((d->>'accounts')::int, 0))
    FROM jsonb_array_elements(p_details) AS d;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.log_bank_sync_run(int,int,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_bank_sync_run(int,int,jsonb) TO authenticated;
