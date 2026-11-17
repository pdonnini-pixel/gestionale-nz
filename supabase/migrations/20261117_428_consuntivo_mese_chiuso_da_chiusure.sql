-- 428 — Consuntivo del mese chiuso dalle chiusure di cassa, il primo del mese alle 9
--
-- Deciso da Patrizio il 17/11/2026:
-- - dal primo giorno del mese successivo, e mai prima, per ogni negozio si sommano le
--   chiusure di cassa del mese appena chiuso (corrispettivi + fatture, lordo IVA), si
--   toglie l'IVA al 22 % e il risultato si scrive nella riga CONSUNTIVO dell'Inserimento
--   rapido (budget_confronto, cons_monthly, granitico) sul conto ricavi del negozio
--   (chart_of_accounts.outlet_link, lo stesso del preventivo);
-- - il valore già presente si SOSTITUISCE (Patrizio: «sostituisci»); il valore di prima
--   resta scritto nel registro (valore_precedente), così niente si perde;
-- - i giorni senza chiusura (negozio chiuso, lavori, apertura in ritardo) contano zero;
--   i giorni «negozio chiuso» contano zero;
-- - se il negozio ha chiusure del mese ancora in BOZZA non si scrive niente per quel
--   negozio: Lilian riceve una mail con l'elenco, e il giro si ripete ogni giorno alle 9
--   finché le bozze non sono confermate;
-- - una volta scritto, il consuntivo di quel negozio e mese non si ricalcola più da solo
--   (registro budget_consuntivo_auto, stato 'scritto'): le correzioni a mano successive
--   restano, e la Rettifica resta per le correzioni manuali;
-- - i mesi successivi non si toccano.
--
-- Convive con il lavoro notturno della 287/288 (consuntivo dal registro corrispettivi,
-- solo celle vuote): per i negozi con chiusure di cassa questo arriva prima e comunque
-- vince; per i negozi senza chiusure (oggi Zago) resta il 287.
--
-- IVA fissa al 22 %: è BUDGET_VAT_RATE di src/lib/cashClosings.ts (chi cambia l'una cambia l'altra).
-- Applicata su NZ → Zago (Made fuori dal 03/11/2026). Niente di distruttivo.

BEGIN;

-- ── 1. Registro per negozio e mese ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.budget_consuntivo_auto (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id),
  year               integer NOT NULL,
  month              integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  cost_center        text NOT NULL,
  outlet_id          uuid REFERENCES public.outlets(id),
  account_code       text NOT NULL,
  stato              text NOT NULL CHECK (stato = ANY (ARRAY['scritto', 'in_attesa_bozze'])),
  lordo              numeric(14,2),
  netto              numeric(14,2),
  chiusure           integer NOT NULL DEFAULT 0,
  bozze              date[] NOT NULL DEFAULT '{}',
  valore_precedente  numeric(14,2),
  scritto_il         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, year, month, cost_center)
);
COMMENT ON TABLE public.budget_consuntivo_auto IS
  'Consuntivo del mese chiuso scritto dal gestionale dalle chiusure di cassa (migration 428): uno per negozio e mese. stato=scritto non si ricalcola più; valore_precedente è il consuntivo che c''era prima.';

ALTER TABLE public.budget_consuntivo_auto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_consuntivo_auto_select ON public.budget_consuntivo_auto;
CREATE POLICY budget_consuntivo_auto_select ON public.budget_consuntivo_auto
  FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND (SELECT public.get_my_role())::text = ANY (ARRAY['super_advisor', 'contabile', 'budget_approver']));
-- Nessuna policy di scrittura: scrive solo la funzione qui sotto (SECURITY DEFINER).
GRANT SELECT ON public.budget_consuntivo_auto TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_consuntivo_auto TO service_role;

-- ── 2. Giro quotidiano (uno per azienda e giorno) ────────────────────────
CREATE TABLE IF NOT EXISTS public.budget_consuntivo_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id),
  run_date         date NOT NULL,
  esito            jsonb,
  mail_request_id  bigint,
  mail_status      text,
  mail_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, run_date)
);
ALTER TABLE public.budget_consuntivo_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_consuntivo_runs_select ON public.budget_consuntivo_runs;
CREATE POLICY budget_consuntivo_runs_select ON public.budget_consuntivo_runs
  FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND (SELECT public.get_my_role())::text = ANY (ARRAY['super_advisor', 'contabile']));
GRANT SELECT ON public.budget_consuntivo_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_consuntivo_runs TO service_role;
-- Solo lettura dall'API: i default dello schema danno anche la scrittura, si toglie.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.budget_consuntivo_auto, public.budget_consuntivo_runs FROM authenticated;
REVOKE ALL ON public.budget_consuntivo_auto, public.budget_consuntivo_runs FROM anon;

-- ── 3. Chi riceve l'avviso delle bozze ───────────────────────────────────
ALTER TABLE public.daily_report_settings
  ADD COLUMN IF NOT EXISTS consuntivo_avviso_recipients text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.daily_report_settings.consuntivo_avviso_recipients IS
  'Indirizzi che ricevono, dal primo del mese alle 9, l''elenco delle chiusure del mese chiuso ancora in bozza (migration 428). Vuoto = nessuna mail.';

-- ── 4. Calcolo e scrittura ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_consuntivo_mese_chiuso(
  p_company_id uuid,
  p_oggi date DEFAULT NULL,
  p_prova boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_iva      constant numeric := 22;   -- = BUDGET_VAT_RATE (src/lib/cashClosings.ts)
  v_oggi     date := COALESCE(p_oggi, (now() AT TIME ZONE 'Europe/Rome')::date);
  v_inizio   date := (date_trunc('month', v_oggi) - interval '1 month')::date;
  v_fine     date := (date_trunc('month', v_oggi) - interval '1 day')::date;
  v_anno     int  := EXTRACT(YEAR FROM v_inizio)::int;
  v_mese     int  := EXTRACT(MONTH FROM v_inizio)::int;
  o          record;
  v_conto    text;
  v_bozze    date[];
  v_n        int;
  v_lordo    numeric;
  v_netto    numeric;
  v_prec     numeric;
  v_scritti  jsonb := '[]'::jsonb;
  v_attesa   jsonb := '[]'::jsonb;
BEGIN
  -- Partenza: si scrive dal consuntivo di novembre 2026 (primo giro vero il 01/12/2026).
  -- Ottobre e i mesi prima restano come sono (corretti a mano il 17/11/2026); la prova si può fare su qualunque mese.
  IF NOT p_prova AND v_inizio < date '2026-11-01' THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'anno', v_anno, 'mese', v_mese, 'prova', false,
                              'scritti', '[]'::jsonb, 'in_attesa', '[]'::jsonb,
                              'motivo', 'mese prima della partenza (novembre 2026)', 'eseguito_il', now());
  END IF;

  FOR o IN
    SELECT ou.id, ou.name, ou.cost_center_key
    FROM public.outlets ou
    WHERE ou.company_id = p_company_id
      AND COALESCE(ou.cost_center_key, '') <> ''
      AND lower(COALESCE(ou.outlet_type, '')) NOT IN ('sede', 'magazzino', 'warehouse', 'hq', 'ufficio')
      AND EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                  WHERE c.outlet_id = ou.id AND c.closing_date BETWEEN v_inizio AND v_fine)
    ORDER BY ou.name
  LOOP
    -- già scritto per questo mese: non si ricalcola più
    IF EXISTS (SELECT 1 FROM public.budget_consuntivo_auto a
               WHERE a.company_id = p_company_id AND a.year = v_anno AND a.month = v_mese
                 AND a.cost_center = o.cost_center_key AND a.stato = 'scritto') THEN
      CONTINUE;
    END IF;

    -- conto ricavi del negozio: lo stesso dell'Inserimento rapido
    SELECT min(ca.code) INTO v_conto FROM public.chart_of_accounts ca
     WHERE ca.company_id = p_company_id AND ca.outlet_link = o.cost_center_key AND ca.is_active;
    IF v_conto IS NULL THEN CONTINUE; END IF;

    SELECT COALESCE(array_agg(c.closing_date ORDER BY c.closing_date) FILTER (WHERE c.status = 'bozza'), '{}'),
           count(*) FILTER (WHERE c.status <> 'bozza'),
           COALESCE(sum(COALESCE(c.total_receipts, 0) + COALESCE(c.invoices_total, 0))
                    FILTER (WHERE c.status <> 'bozza' AND NOT c.is_closed_day), 0)
      INTO v_bozze, v_n, v_lordo
      FROM public.outlet_daily_closings c
     WHERE c.outlet_id = o.id AND c.closing_date BETWEEN v_inizio AND v_fine;

    IF cardinality(v_bozze) > 0 THEN
      v_attesa := v_attesa || jsonb_build_array(jsonb_build_object(
        'outlet', o.name, 'cost_center', o.cost_center_key, 'bozze', to_jsonb(v_bozze)));
      IF NOT p_prova THEN
        INSERT INTO public.budget_consuntivo_auto
          (company_id, year, month, cost_center, outlet_id, account_code, stato, chiusure, bozze, updated_at)
        VALUES (p_company_id, v_anno, v_mese, o.cost_center_key, o.id, v_conto, 'in_attesa_bozze', v_n, v_bozze, now())
        ON CONFLICT (company_id, year, month, cost_center) DO UPDATE
          SET stato = 'in_attesa_bozze', chiusure = EXCLUDED.chiusure, bozze = EXCLUDED.bozze,
              account_code = EXCLUDED.account_code, updated_at = now();
      END IF;
      CONTINUE;
    END IF;

    v_netto := round(v_lordo / (1 + c_iva / 100), 2);
    SELECT bc.amount INTO v_prec FROM public.budget_confronto bc
     WHERE bc.company_id = p_company_id AND bc.cost_center = o.cost_center_key AND bc.account_code = v_conto
       AND bc.year = v_anno AND bc.month = v_mese AND bc.entry_type = 'cons_monthly';

    v_scritti := v_scritti || jsonb_build_array(jsonb_build_object(
      'outlet', o.name, 'cost_center', o.cost_center_key, 'conto', v_conto, 'chiusure', v_n,
      'lordo', round(v_lordo, 2), 'netto', v_netto, 'valore_precedente', v_prec));

    IF NOT p_prova THEN
      IF v_netto <> 0 THEN
        INSERT INTO public.budget_confronto
          (company_id, cost_center, account_code, year, month, entry_type, amount, stato, updated_at)
        VALUES (p_company_id, o.cost_center_key, v_conto, v_anno, v_mese, 'cons_monthly', v_netto, 'granitico', now())
        ON CONFLICT (company_id, cost_center, account_code, year, month, entry_type) DO UPDATE
          SET amount = EXCLUDED.amount, stato = 'granitico', updated_at = now();
      ELSIF v_prec IS NOT NULL THEN
        -- mese a zero (solo giorni di negozio chiuso): si sostituisce anche qui, con 0.
        -- La riga resta (niente DELETE) e il valore di prima è in valore_precedente.
        UPDATE public.budget_confronto SET amount = 0, stato = 'granitico', updated_at = now()
         WHERE company_id = p_company_id AND cost_center = o.cost_center_key AND account_code = v_conto
           AND year = v_anno AND month = v_mese AND entry_type = 'cons_monthly';
      END IF;
      INSERT INTO public.budget_consuntivo_auto
        (company_id, year, month, cost_center, outlet_id, account_code, stato, lordo, netto, chiusure, bozze,
         valore_precedente, scritto_il, updated_at)
      VALUES (p_company_id, v_anno, v_mese, o.cost_center_key, o.id, v_conto, 'scritto', round(v_lordo, 2), v_netto, v_n,
              '{}', v_prec, now(), now())
      ON CONFLICT (company_id, year, month, cost_center) DO UPDATE
        SET stato = 'scritto', lordo = EXCLUDED.lordo, netto = EXCLUDED.netto, chiusure = EXCLUDED.chiusure,
            bozze = '{}', valore_precedente = EXCLUDED.valore_precedente, account_code = EXCLUDED.account_code,
            scritto_il = now(), updated_at = now();
    END IF;
  END LOOP;

  RETURN jsonb_build_object('company_id', p_company_id, 'anno', v_anno, 'mese', v_mese, 'prova', p_prova,
                            'scritti', v_scritti, 'in_attesa', v_attesa, 'eseguito_il', now());
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_consuntivo_mese_chiuso(uuid, date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_consuntivo_mese_chiuso(uuid, date, boolean) TO service_role;

-- ── 5. Giro delle 9 e avviso a chi è in elenco ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_consuntivo_mese_chiuso_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net', 'vault', 'pg_temp'
AS $function$
DECLARE
  v_local   timestamp := now() AT TIME ZONE 'Europe/Rome';
  v_today   date := (now() AT TIME ZONE 'Europe/Rome')::date;
  c         record;
  v_run     uuid;
  v_esito   jsonb;
  v_dest    text[];
  v_secret  text;
  v_url     text;
  v_anon    text;
  v_req     bigint;
  v_n       int := 0;
BEGIN
  IF v_local::time < time '09:00' THEN
    RETURN jsonb_build_object('giri', 0, 'motivo', 'prima delle 9');
  END IF;

  FOR c IN SELECT id FROM public.companies LOOP
    INSERT INTO public.budget_consuntivo_runs (company_id, run_date)
    VALUES (c.id, v_today)
    ON CONFLICT (company_id, run_date) DO NOTHING
    RETURNING id INTO v_run;
    IF v_run IS NULL THEN CONTINUE; END IF;   -- oggi già fatto
    v_n := v_n + 1;

    BEGIN
      v_esito := public.fn_consuntivo_mese_chiuso(c.id, v_today, false);
      UPDATE public.budget_consuntivo_runs SET esito = v_esito WHERE id = v_run;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.budget_consuntivo_runs SET esito = jsonb_build_object('errore', SQLERRM) WHERE id = v_run;
      CONTINUE;
    END;

    IF jsonb_array_length(COALESCE(v_esito->'in_attesa', '[]'::jsonb)) = 0 THEN CONTINUE; END IF;

    SELECT s.consuntivo_avviso_recipients INTO v_dest FROM public.daily_report_settings s WHERE s.company_id = c.id;
    IF v_dest IS NULL OR cardinality(v_dest) = 0 THEN
      UPDATE public.budget_consuntivo_runs SET mail_status = 'nessun_destinatario' WHERE id = v_run;
      CONTINUE;
    END IF;

    SELECT decrypted_secret::text INTO v_secret FROM vault.decrypted_secrets WHERE name = 'autofix_cron_secret' LIMIT 1;
    SELECT replace(e.function_url, 'daily-cash-report-send', 'consuntivo-mese-avviso'), e.anon_key
      INTO v_url, v_anon FROM public.daily_report_endpoint() e;
    IF v_secret IS NULL OR v_url IS NULL OR v_anon IS NULL THEN
      UPDATE public.budget_consuntivo_runs SET mail_status = 'errore',
             mail_error = 'segreto del cron o indirizzo della funzione non trovati' WHERE id = v_run;
      CONTINUE;
    END IF;

    SELECT net.http_post(
      url     := v_url,
      body    := jsonb_build_object('run_id', v_run, 'company_id', c.id, 'esito', v_esito),
      params  := '{}'::jsonb,
      headers := jsonb_build_object(
                   'Content-Type',   'application/json',
                   'Authorization',  'Bearer ' || v_anon,
                   'apikey',         v_anon,
                   'x-autofix-cron', v_secret),
      timeout_milliseconds := 60000
    ) INTO v_req;
    UPDATE public.budget_consuntivo_runs SET mail_request_id = v_req, mail_status = 'in_invio' WHERE id = v_run;
  END LOOP;

  RETURN jsonb_build_object('giri', v_n, 'at', now());
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_consuntivo_mese_chiuso_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_consuntivo_mese_chiuso_tick() TO service_role;

COMMIT;

-- Il cron sta fuori dalla transazione: ogni 20 minuti, ma lavora una volta al giorno dalle 9 (ora di Roma).
SELECT cron.schedule('consuntivo-mese-chiuso-tick', '*/20 * * * *',
  $cron$SELECT public.fn_consuntivo_mese_chiuso_tick();$cron$);

-- Verifica, su ogni tenant:
-- SELECT public.fn_consuntivo_mese_chiuso((SELECT id FROM companies LIMIT 1), current_date, true);  -- prova, non scrive
-- SELECT has_table_privilege('authenticated','public.budget_consuntivo_auto','select') AS auth,
--        has_table_privilege('service_role','public.budget_consuntivo_auto','insert') AS srv;
-- SELECT jobname, schedule FROM cron.job WHERE jobname = 'consuntivo-mese-chiuso-tick';
