-- ============================================================================
-- 308 — Le 9 funzioni che restavano diverse fra i tenant, allineate a NZ
-- ============================================================================
-- Seguito dell'audit del 20/10/2026 (AUDIT_PARITA_TENANT.md). Dopo aver escluso
-- 18 divergenze di sola formattazione, restavano 9 funzioni il cui testo non
-- coincideva sui tre tenant. Patrizio ha chiesto di allinearle tutte.
--
-- PERCHÉ IL TESTO E NON SOLO LA LOGICA. Leggendole una per una, alcune di queste
-- 9 fanno già la stessa cosa e differiscono per uno spazio dopo una virgola o per
-- un alias scritto `AS d` invece di `d`: nessuna misura testuale automatica le
-- distingue dalle differenze vere, e ogni audit futuro ricomincerebbe a segnalarle.
-- Allineare il testo al carattere toglie quel rumore per sempre.
--
-- La sola differenza di comportamento trovata leggendo i testi è
-- `get_autofix_cron_secret`, che su Zago aveva `search_path` senza `extensions`,
-- dove vivono le funzioni di decrittazione del Vault. Per `_suppliers_slugify` e
-- `close_incoming_movements` avevo scritto che la differenza era sostanziale (gli
-- accenti, il filtro delle entrate): sbagliato, misurato male. Con la normalizzazione
-- degli spazi attorno alla punteggiatura si vede che la logica era già la stessa.
--
-- COSA È RIMASTO FUORI. `close_incoming_movements` non è stata applicata: il
-- connettore Supabase manda in timeout quel payload in modo ripetibile (quattro
-- tentativi, su Made e su Zago, con apply_migration, con execute_sql e dentro un
-- blocco DO), mentre ogni altra funzione passa. Il sospetto è un filtro che reagisce
-- al contenuto del suo regex, dove compaiono i nomi dei circuiti delle carte.
-- Poiché la sua logica è identica sui tre tenant (verificata leggendo entrambe le
-- versioni riga per riga), non si è forzata la mano con una patch testuale fragile su
-- due database dove quella funzione fa già la stessa cosa.
--
-- COME. Il testo è quello che `pg_get_functiondef` restituisce su NZ, copiato
-- senza riscritture. NZ è il riferimento perché è il tenant in produzione, con i
-- dati veri e le migration più recenti.
--
-- PRIMA DI COPIARE, due verifiche fatte:
--   1. nessuna delle 9 contiene valori legati a un tenant (UUID, P.IVA, nome
--      azienda, project_id): controllato con regexp su tutte e nove;
--   2. le firme sono identiche sui tre tenant, quindi `CREATE OR REPLACE`
--      sostituisce e non crea un overload che lascerebbe due funzioni in piedi.
--
-- Quattro di queste sono funzioni di trigger (`acube_tx_set_dedup_hash`,
-- `ensure_acube_business_registry_stub`, `sync_acube_account_to_bank_account`,
-- `sync_employee_costs_from_slips`): sostituire la funzione non stacca i trigger
-- che la usano, e i trigger erano già identici sui tre.
--
-- `CREATE OR REPLACE` su una funzione che esiste mantiene i privilegi: i GRANT
-- restano quelli che c'erano. Verificato dopo l'applicazione.
--
-- Applicata su Made e Zago (su NZ è già questo il testo), in gruppi separati perché
-- il connettore non regge un payload unico da 18 KB. Esito: 8 funzioni su 9 ora
-- identiche al carattere sui tre tenant; `close_incoming_movements` resta come era.
-- Permessi verificati invariati dopo l'applicazione, e i 4 trigger che usano queste
-- funzioni sono ancora attaccati (73 trigger su tutti e tre, come prima).
--
-- Rollback: non previsto. Tornare indietro rifarebbe la divergenza che questa
-- migration chiude; il testo precedente resta nella storia di questo file.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._suppliers_slugify(input text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT lower(
    regexp_replace(
      regexp_replace(
        trim(coalesce(input, '')),
        '[àáâãäå]', 'a', 'g'
      ),
      '[^a-zA-Z0-9]+', '-', 'g'
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.acube_tx_set_dedup_hash()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
BEGIN
  NEW.dedup_hash := md5(
    coalesce(NEW.end_to_end_id, '') || '|' ||
    NEW.made_on::text || '|' ||
    NEW.amount::text || '|' ||
    coalesce(NEW.description, '') || '|' ||
    NEW.acube_account_uuid::text
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_autofix_cron_secret()
 RETURNS TABLE(secret text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'extensions'
AS $function$
  SELECT decrypted_secret::text FROM vault.decrypted_secrets WHERE name = 'autofix_cron_secret' LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.close_incoming_movements(p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE v_res jsonb; v_n int;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _inc_match (id uuid, categoria text) ON COMMIT DROP;
  DELETE FROM _inc_match;
  INSERT INTO _inc_match (id, categoria)
  SELECT x.id,
    CASE
      WHEN d ~ '(P\.?O\.?S\.?|PAGOBANCOMAT|\yCARTE\y|MASTERCARD|\yVISA\y|AMERICAN EXPRESS|CIRCUITO|ACCREDITO POS|INCASSO TRAMITE|NUMIA|INCASSI INTERNAZIONALI)' THEN 'incassi_pos'
      WHEN d ~ '(VERSAMENTO|VERS\.|CASSA CONTIN|\yATM\y)' THEN 'versamenti'
      WHEN d ~ '(INTERESS|STORNO|ACCREDITO COMPETENZE)' THEN 'finanziarie'
      ELSE NULL END
  FROM (
    SELECT bt.id, upper(coalesce(bt.description,'') || ' ' || coalesce(bt.counterpart,'') || ' ' || coalesce(bt.merchant_name,'')) d
    FROM public.bank_transactions bt
    WHERE bt.amount > 0 AND COALESCE(bt.is_reconciled,false) = false AND bt.status IN ('posted','booked')
  ) x
  WHERE d !~ '(BONIFICO|BON ISTANT|A VOSTRO FAVORE|A FAVORE DI|\yGIROCONTO\y|GIROC|FINANZIAMENT|\yMUTU|ANTICIPO|FIDEIUSSION|FIDEJ)';
  DELETE FROM _inc_match WHERE categoria IS NULL;

  SELECT jsonb_object_agg(categoria, n) INTO v_res
  FROM (SELECT categoria, count(*) n FROM _inc_match GROUP BY categoria) y;

  IF p_dry_run THEN
    RETURN jsonb_build_object('dry_run', true, 'da_chiudere', COALESCE(v_res,'{}'::jsonb),
      'totale', (SELECT count(*) FROM _inc_match),
      'valore', (SELECT round(sum(bt.amount),2) FROM public.bank_transactions bt JOIN _inc_match m ON m.id=bt.id));
  END IF;

  UPDATE public.bank_transactions bt
  SET is_reconciled = true, reconciled_at = now(), category = m.categoria,
      note = COALESCE(bt.note || ' | ', '') || 'chiuso automaticamente (entrata: ' || m.categoria || ')'
  FROM _inc_match m WHERE m.id = bt.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('dry_run', false, 'chiusi', v_n, 'per_categoria', COALESCE(v_res,'{}'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_acube_business_registry_stub()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
BEGIN
  -- 1) Auto-stub business_registry se business_fiscal_id manca dalla tabella
  IF NEW.business_fiscal_id IS NOT NULL THEN
    INSERT INTO public.acube_sdi_business_registry_configs (
      fiscal_id, vat_number, name, email, stage,
      customer_invoice_enabled, supplier_invoice_enabled,
      receipts_enabled, legal_storage_active
    ) VALUES (
      NEW.business_fiscal_id,
      NEW.business_fiscal_id,
      '[Auto-stub] ' || NEW.business_fiscal_id,
      'autostub@gestionalenz.local',
      coalesce((SELECT stage FROM public.acube_sdi_business_registry_configs LIMIT 1), 'sandbox'),
      false, false, false, false
    )
    ON CONFLICT (fiscal_id) DO NOTHING;
  END IF;

  -- 2) Normalizza NEW.* per evitare NOT NULL violation nei downstream trigger
  NEW.total_amount := coalesce(NEW.total_amount, 0);
  NEW.invoice_number := coalesce(
    nullif(trim(NEW.invoice_number), ''),
    '[A-Cube ' || substring(NEW.acube_uuid::text from 1 for 8) || ']'
  );
  NEW.invoice_date := coalesce(NEW.invoice_date, NEW.acube_created_at::date, current_date);
  NEW.sender_name := coalesce(
    nullif(trim(NEW.sender_name), ''),
    NEW.sender_vat,
    'Cedente non specificato'
  );
  NEW.sender_vat := coalesce(NEW.sender_vat, '__UNKNOWN__');
  NEW.currency := coalesce(NEW.currency, 'EUR');
  NEW.marking := coalesce(NEW.marking, 'received');

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_acube_account_to_bank_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE v_company_id UUID; v_bank_account_id UUID;
BEGIN
  IF NOT NEW.enabled THEN RETURN NEW; END IF;
  SELECT id INTO v_company_id FROM public.companies LIMIT 1;
  IF v_company_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.bank_accounts (
    id, company_id, bank_name, account_name, iban, account_type,
    currency, current_balance, is_active, is_manual,
    acube_account_uuid, balance_updated_at
  ) VALUES (
    gen_random_uuid(), v_company_id, NEW.provider_name, NEW.name, NEW.iban,
    CASE NEW.nature WHEN 'checking' THEN 'corrente' WHEN 'savings' THEN 'risparmio'
      WHEN 'credit_card' THEN 'carta_credito' WHEN 'debit_card' THEN 'carta_debito'
      WHEN 'card' THEN 'carta' WHEN 'loan' THEN 'finanziamento' WHEN 'mortgage' THEN 'mutuo'
      ELSE NEW.nature END,
    NEW.currency_code, NEW.balance, true, false, NEW.uuid, now()
  )
  ON CONFLICT (acube_account_uuid) DO UPDATE SET
    bank_name = EXCLUDED.bank_name, account_name = EXCLUDED.account_name, iban = EXCLUDED.iban,
    currency = EXCLUDED.currency, current_balance = EXCLUDED.current_balance,
    is_active = EXCLUDED.is_active, balance_updated_at = now()
  RETURNING id INTO v_bank_account_id;
  UPDATE public.acube_accounts SET bank_account_id = v_bank_account_id WHERE uuid = NEW.uuid;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.sync_employee_costs_from_slips()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  k_company uuid; k_emp uuid; k_year int; k_month int;
  n_slips int;
  v_netto numeric; v_retr numeric; v_contr numeric; v_inail numeric;
  v_tfr numeric; v_altri numeric; v_outlet text; v_outlet_src text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    k_company := OLD.company_id; k_emp := OLD.employee_id; k_year := OLD.year; k_month := OLD.month;
  ELSE
    k_company := NEW.company_id; k_emp := NEW.employee_id; k_year := NEW.year; k_month := NEW.month;
  END IF;

  SELECT count(*) INTO n_slips FROM employee_cost_slips s
   WHERE s.company_id = k_company AND s.employee_id = k_emp
     AND s.year = k_year AND s.month = k_month;

  IF n_slips = 0 THEN
    UPDATE employee_costs c SET netto = NULL
     WHERE c.company_id = k_company AND c.employee_id = k_emp
       AND c.year = k_year AND c.month = k_month;
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM employee_cost_slips s
              WHERE s.company_id = k_company AND s.employee_id = k_emp
                AND s.year = k_year AND s.month = k_month AND s.tipo = 'manuale') THEN
    SELECT s.netto, COALESCE(s.retribuzione,0), COALESCE(s.contributi,0), COALESCE(s.inail,0),
           COALESCE(s.tfr,0), COALESCE(s.altri_costi,0), s.outlet_code, s.outlet_source
      INTO v_netto, v_retr, v_contr, v_inail, v_tfr, v_altri, v_outlet, v_outlet_src
      FROM employee_cost_slips s
     WHERE s.company_id = k_company AND s.employee_id = k_emp
       AND s.year = k_year AND s.month = k_month AND s.tipo = 'manuale';
  ELSE
    SELECT CASE WHEN count(*) FILTER (WHERE s.netto IS NOT NULL) > 0
                THEN sum(COALESCE(s.netto,0)) ELSE NULL END,
           sum(COALESCE(s.retribuzione,0)), sum(COALESCE(s.contributi,0)),
           sum(COALESCE(s.inail,0)), sum(COALESCE(s.tfr,0)), sum(COALESCE(s.altri_costi,0)),
           -- outlet del mese = quello del cedolino piu' pesante
           (array_agg(s.outlet_code ORDER BY COALESCE(s.netto,0) DESC)
              FILTER (WHERE s.outlet_code IS NOT NULL))[1],
           (array_agg(s.outlet_source ORDER BY COALESCE(s.netto,0) DESC)
              FILTER (WHERE s.outlet_code IS NOT NULL))[1]
      INTO v_netto, v_retr, v_contr, v_inail, v_tfr, v_altri, v_outlet, v_outlet_src
      FROM employee_cost_slips s
     WHERE s.company_id = k_company AND s.employee_id = k_emp
       AND s.year = k_year AND s.month = k_month;
  END IF;

  INSERT INTO employee_costs (company_id, employee_id, year, month, netto, retribuzione,
                              contributi, inail, tfr, altri_costi, outlet_code, outlet_source)
  VALUES (k_company, k_emp, k_year, k_month, v_netto, v_retr, v_contr, v_inail, v_tfr,
          v_altri, v_outlet, v_outlet_src)
  ON CONFLICT (employee_id, year, month) DO UPDATE SET
    netto = EXCLUDED.netto, retribuzione = EXCLUDED.retribuzione,
    contributi = EXCLUDED.contributi, inail = EXCLUDED.inail, tfr = EXCLUDED.tfr,
    altri_costi = EXCLUDED.altri_costi,
    outlet_code = COALESCE(EXCLUDED.outlet_code, employee_costs.outlet_code),
    outlet_source = COALESCE(EXCLUDED.outlet_source, employee_costs.outlet_source);

  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.ticket_autofix_run(p_function_url text, p_anon_key text, p_max_tickets integer DEFAULT 3)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net', 'vault', 'extensions'
AS $function$
DECLARE
  v_secret  text;
  v_ticket  record;
  v_request bigint;
  v_count   integer := 0;
BEGIN
  SELECT decrypted_secret::text INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'autofix_cron_secret' LIMIT 1;
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'autofix_cron_secret assente nel vault: la edge function rifiuterebbe la chiamata';
  END IF;

  FOR v_ticket IN
    SELECT id
      FROM public.tickets
     WHERE stato = 'aperto'
       AND COALESCE(autofix_attempts, 0) < 3
       AND (autofix_last_attempt_at IS NULL OR autofix_last_attempt_at < now() - interval '50 minutes')
       AND NOT EXISTS (
             SELECT 1
               FROM jsonb_array_elements(COALESCE(commenti, '[]'::jsonb)) AS c
              WHERE c->>'origine' = 'ai'
           )
     ORDER BY creato_il
     LIMIT GREATEST(p_max_tickets, 0)
  LOOP
    SELECT net.http_post(
      url                  := p_function_url,
      body                 := jsonb_build_object('ticketId', v_ticket.id),
      params               := '{}'::jsonb,
      headers              := jsonb_build_object(
                                'Content-Type',   'application/json',
                                'Authorization',  'Bearer ' || p_anon_key,
                                'apikey',         p_anon_key,
                                'x-autofix-cron', v_secret
                              ),
      timeout_milliseconds := 120000
    ) INTO v_request;

    UPDATE public.tickets
       SET autofix_attempts        = COALESCE(autofix_attempts, 0) + 1,
           autofix_last_attempt_at = now(),
           autofix_last_request_id = v_request
     WHERE id = v_ticket.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END
$function$;

CREATE OR REPLACE FUNCTION public.refresh_budget_consuntivo(p_outlet_id uuid DEFAULT NULL::uuid, p_year integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_company_id uuid; v_role text; v_outlet_code text; v_year integer;
  v_revenue_account text := '510101';
  v_rows_updated integer := 0; v_total_ricavi numeric := 0; v_total_costi numeric := 0;
BEGIN
  v_role := COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '');
  IF v_role = 'ceo' THEN
    RAISE EXCEPTION 'Role ceo cannot refresh consuntivo (read-only executive)'
      USING HINT = 'Chiedi a contabile/super_advisor di aggiornare il consuntivo';
  END IF;
  v_company_id := public._caller_company_id();
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'No company associated with caller — login required'; END IF;
  v_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::integer);
  IF p_outlet_id IS NOT NULL THEN
    SELECT code INTO v_outlet_code FROM outlets WHERE id = p_outlet_id AND company_id = v_company_id;
    IF v_outlet_code IS NULL THEN RAISE EXCEPTION 'Outlet % not found in current tenant', p_outlet_id; END IF;
  END IF;
  PERFORM set_config('app.budget_bypass_lock', 'on', true);
  WITH
  -- B2C: ricavi POS giornalieri → mappati al corrispettivo dell'outlet specifico
  -- (510107 Valdichiana, 510108 Barberino, ecc.) via outlets.code → chart_of_accounts.code
  rev_b2c AS (
    SELECT COALESCE(o.code, 'all') AS cost_center, v_year AS year,
           EXTRACT(MONTH FROM dr.date)::integer AS month,
           -- Mapping outlet → conto corrispettivo dedicato (se esiste in chart_of_accounts)
           COALESCE(
             (SELECT coa.code FROM chart_of_accounts coa
              WHERE coa.company_id = v_company_id AND coa.level = 3
                AND coa.is_revenue = true
                AND coa.name ILIKE '%' || COALESCE(o.name, '') || '%'
              LIMIT 1),
             '510101'  -- Fallback: ricavi vendite Italia
           ) AS account_code,
           COALESCE(SUM(dr.net_revenue), 0)::numeric AS amount,
           'daily_revenue'::text AS source
    FROM daily_revenue dr LEFT JOIN outlets o ON o.id = dr.outlet_id
    WHERE dr.company_id = v_company_id
      AND EXTRACT(YEAR FROM dr.date)::integer = v_year
      AND (p_outlet_id IS NULL OR dr.outlet_id = p_outlet_id)
    GROUP BY o.code, o.name, EXTRACT(MONTH FROM dr.date)
  ),
  -- B2B: fatture attive → 510101 ricavi vendite Italia
  rev_b2b AS (
    SELECT COALESCE(o.code, 'all') AS cost_center, v_year AS year,
           EXTRACT(MONTH FROM ai.invoice_date)::integer AS month,
           v_revenue_account AS account_code,
           COALESCE(SUM(ai.taxable_amount), 0)::numeric AS amount,
           'active_invoices'::text AS source
    FROM active_invoices ai LEFT JOIN outlets o ON o.id = ai.outlet_id
    WHERE ai.company_id = v_company_id
      AND EXTRACT(YEAR FROM ai.invoice_date)::integer = v_year
      AND (p_outlet_id IS NULL OR ai.outlet_id = p_outlet_id)
    GROUP BY COALESCE(o.code, 'all'), EXTRACT(MONTH FROM ai.invoice_date)
  ),
  -- Costi: fatture passive → cost_categories.ce_account_code (NEW: usa il mapping)
  costs AS (
    SELECT COALESCE(o.code, 'all') AS cost_center, v_year AS year,
           EXTRACT(MONTH FROM ei.invoice_date)::integer AS month,
           COALESCE(cc.ce_account_code, cc.code) AS account_code,
           COALESCE(SUM(ei.net_amount), 0)::numeric AS amount,
           'electronic_invoices'::text AS source
    FROM electronic_invoices ei
    JOIN cost_categories cc ON cc.id = ei.cost_category_id
    LEFT JOIN outlets o ON o.id = ei.outlet_id
    WHERE ei.company_id = v_company_id AND ei.invoice_date IS NOT NULL
      AND EXTRACT(YEAR FROM ei.invoice_date)::integer = v_year
      AND ei.cost_category_id IS NOT NULL
      AND (p_outlet_id IS NULL OR ei.outlet_id = p_outlet_id)
    GROUP BY COALESCE(o.code, 'all'), EXTRACT(MONTH FROM ei.invoice_date), COALESCE(cc.ce_account_code, cc.code)
  ),
  all_sources AS (
    SELECT * FROM rev_b2c UNION ALL SELECT * FROM rev_b2b UNION ALL SELECT * FROM costs
  ),
  totals AS (
    SELECT cost_center, year, month, account_code,
           SUM(amount) AS total, jsonb_object_agg(source, amount) AS breakdown
    FROM all_sources WHERE amount <> 0
    GROUP BY cost_center, year, month, account_code
  )
  UPDATE budget_entries be
  SET actual_amount = t.total, actual_refreshed_at = NOW(),
      actual_breakdown = t.breakdown, updated_at = NOW()
  FROM totals t
  WHERE be.company_id = v_company_id
    AND be.cost_center = t.cost_center AND be.year = t.year
    AND be.month = t.month AND be.account_code = t.account_code
    AND (p_outlet_id IS NULL OR be.cost_center = v_outlet_code);
  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  UPDATE budget_entries SET actual_refreshed_at = NOW(), updated_at = NOW()
  WHERE company_id = v_company_id AND year = v_year
    AND (p_outlet_id IS NULL OR cost_center = v_outlet_code)
    AND actual_refreshed_at IS NULL;

  -- Totali ricavi: somma di account_code che iniziano con 5 (511xxx, 5901xx, ecc.)
  SELECT COALESCE(SUM(actual_amount), 0) INTO v_total_ricavi FROM budget_entries
  WHERE company_id = v_company_id AND year = v_year
    AND account_code LIKE '5%'
    AND (p_outlet_id IS NULL OR cost_center = v_outlet_code);
  SELECT COALESCE(SUM(actual_amount), 0) INTO v_total_costi FROM budget_entries
  WHERE company_id = v_company_id AND year = v_year
    AND account_code NOT LIKE '5%'
    AND (p_outlet_id IS NULL OR cost_center = v_outlet_code);

  RETURN jsonb_build_object(
    'success', true, 'rows_updated', v_rows_updated, 'year', v_year,
    'outlet_id', p_outlet_id, 'outlet_code', v_outlet_code,
    'total_ricavi_consuntivo', v_total_ricavi,
    'total_costi_consuntivo', v_total_costi,
    'risultato_consuntivo', v_total_ricavi - ABS(v_total_costi),
    'refreshed_at', NOW()
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
END;
$function$;

-- ============================================================================
-- Verifica (da eseguire sui tre tenant: l'impronta deve essere la stessa)
-- ============================================================================
--   SELECT left(md5(string_agg(p.proname || md5(pg_get_functiondef(p.oid)), E'\n'
--            ORDER BY p.proname)), 10) AS impronta_9
--     FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
--    WHERE ns.nspname = 'public' AND p.prokind = 'f'
--      AND p.proname IN ('_suppliers_slugify','acube_tx_set_dedup_hash',
--        'close_incoming_movements','ensure_acube_business_registry_stub',
--        'sync_employee_costs_from_slips','refresh_budget_consuntivo',
--        'get_autofix_cron_secret','sync_acube_account_to_bank_account',
--        'ticket_autofix_run');
--
-- E i privilegi devono essere rimasti quelli di prima:
--   SELECT p.proname, array_to_string(p.proacl, ' ') FROM pg_proc p … ;
-- ============================================================================
