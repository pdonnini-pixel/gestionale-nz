-- =============================================================================
-- Migrazione 014 — Refresh Budget Consuntivo (Lavoro 1 Task A)
-- =============================================================================
--
-- Obiettivo: aggregare in tempo reale il "consuntivo" finanziario di ogni
-- riga di budget_entries da fonti reali, senza data entry manuale.
--
-- Cosa AGGREGA (v1):
--   * Ricavi (account_code = '510100'):
--       - daily_revenue.net_revenue (B2C POS giornaliero)
--       - active_invoices.taxable_amount (B2B fatture attive SDI)
--   * Costi (per account_code da cost_categories.code):
--       - electronic_invoices.net_amount (fatture passive ricevute) GROUP BY cost_category_id
--
-- Cosa NON AGGREGA (esclusi dalla v1, dichiarato per evitare confusione):
--   * cash_movements: sono per cassa, il consuntivo qui è per competenza.
--                     Coperto in modulo Banche/Riconciliazione separato.
--   * corrispettivi_log: doppione di daily_revenue (è solo l'invio AdE).
--                        Inclusione produrrebbe doppia contabilizzazione ricavi.
--   * employee_costs / monthly_cost_lines: costi del personale, da aggiungere
--                                          quando perfezioneremo pagina Dipendenti.
--
-- Mapping outlet:
--   * outlets.id (FK nelle fonti) → outlets.code (text) → budget_entries.cost_center
--   * Righe sorgente con outlet_id NULL → consuntivo va su cost_center = 'all'
--
-- Persistenza:
--   * Risultati persistiti in budget_entries.actual_amount
--   * actual_refreshed_at: timestamp dell'ultimo refresh
--   * actual_breakdown: jsonb con dettaglio sorgenti per drill-down UI
--   * Trigger su INSERT/UPDATE/DELETE delle 4 fonti azzera actual_refreshed_at
--     → la UI mostra "consuntivo da aggiornare" e bottone diventa giallo
--
-- Guardia ruolo:
--   * Role 'ceo' non può eseguire la RPC (read-only executive).
--   * Tutti gli altri authenticated possono.
--
-- Multi-tenant: company_id estratto dal JWT del caller; UPDATE è scoped al
-- proprio tenant via WHERE company_id = caller_company_id.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Estensione schema budget_entries: metadata consuntivo
-- -----------------------------------------------------------------------------

ALTER TABLE budget_entries
  ADD COLUMN IF NOT EXISTS actual_refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_breakdown jsonb;

COMMENT ON COLUMN budget_entries.actual_refreshed_at IS
  'Timestamp ultimo refresh del consuntivo via refresh_budget_consuntivo(). NULL = stale, da rinfrescare.';

COMMENT ON COLUMN budget_entries.actual_breakdown IS
  'Dettaglio sorgenti del consuntivo: { daily_revenue: X, active_invoices: Y, electronic_invoices: Z }. Per drill-down UI.';

-- -----------------------------------------------------------------------------
-- 2) Helper: company_id del caller (da JWT app_metadata o user_profiles)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._caller_company_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  -- Tenta prima da JWT app_metadata
  BEGIN
    v_company_id := (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_company_id := NULL;
  END;

  IF v_company_id IS NOT NULL THEN
    RETURN v_company_id;
  END IF;

  -- Fallback: legge da user_profiles
  SELECT up.company_id INTO v_company_id
  FROM user_profiles up
  WHERE up.id = auth.uid()
  LIMIT 1;

  IF v_company_id IS NULL THEN
    -- Single-company tenant: prendi l'unica company
    SELECT id INTO v_company_id FROM companies LIMIT 2;
    IF (SELECT COUNT(*) FROM companies) = 1 THEN
      SELECT id INTO v_company_id FROM companies LIMIT 1;
    ELSE
      v_company_id := NULL;
    END IF;
  END IF;

  RETURN v_company_id;
END;
$$;

COMMENT ON FUNCTION public._caller_company_id() IS
  'Helper interno: ritorna company_id del caller, prima da JWT poi da user_profiles, fallback su single-company tenant.';

-- -----------------------------------------------------------------------------
-- 3) RPC principale: refresh_budget_consuntivo
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refresh_budget_consuntivo(
  p_outlet_id uuid DEFAULT NULL,   -- NULL = tutti gli outlet del tenant
  p_year integer DEFAULT NULL      -- NULL = anno corrente
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_role text;
  v_outlet_code text;
  v_year integer;
  v_revenue_account text := '510100';
  v_rows_updated integer := 0;
  v_total_ricavi numeric := 0;
  v_total_costi numeric := 0;
BEGIN
  -- Guardia ruolo: CEO è read-only
  v_role := COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '');
  IF v_role = 'ceo' THEN
    RAISE EXCEPTION 'Role ceo cannot refresh consuntivo (read-only executive)'
      USING HINT = 'Chiedi a contabile/super_advisor di aggiornare il consuntivo';
  END IF;

  -- Identifica company del caller
  v_company_id := public._caller_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No company associated with caller — login required';
  END IF;

  -- Anno: default = corrente
  v_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::integer);

  -- Se outlet specifico: risolvi code e verifica appartenenza al tenant
  IF p_outlet_id IS NOT NULL THEN
    SELECT code INTO v_outlet_code
    FROM outlets
    WHERE id = p_outlet_id AND company_id = v_company_id;

    IF v_outlet_code IS NULL THEN
      RAISE EXCEPTION 'Outlet % not found in current tenant', p_outlet_id;
    END IF;
  END IF;

  -- =========================================================================
  -- Calcolo aggregato consuntivo + breakdown sorgenti
  -- =========================================================================
  WITH
  -- Ricavi B2C: daily_revenue
  rev_b2c AS (
    SELECT
      COALESCE(o.code, 'all') AS cost_center,
      v_year AS year,
      EXTRACT(MONTH FROM dr.date)::integer AS month,
      v_revenue_account AS account_code,
      COALESCE(SUM(dr.net_revenue), 0)::numeric AS amount,
      'daily_revenue'::text AS source
    FROM daily_revenue dr
    LEFT JOIN outlets o ON o.id = dr.outlet_id
    WHERE dr.company_id = v_company_id
      AND EXTRACT(YEAR FROM dr.date)::integer = v_year
      AND (p_outlet_id IS NULL OR dr.outlet_id = p_outlet_id)
    GROUP BY COALESCE(o.code, 'all'), EXTRACT(MONTH FROM dr.date)
  ),
  -- Ricavi B2B: active_invoices
  rev_b2b AS (
    SELECT
      COALESCE(o.code, 'all') AS cost_center,
      v_year AS year,
      EXTRACT(MONTH FROM ai.invoice_date)::integer AS month,
      v_revenue_account AS account_code,
      COALESCE(SUM(ai.taxable_amount), 0)::numeric AS amount,
      'active_invoices'::text AS source
    FROM active_invoices ai
    LEFT JOIN outlets o ON o.id = ai.outlet_id
    WHERE ai.company_id = v_company_id
      AND EXTRACT(YEAR FROM ai.invoice_date)::integer = v_year
      AND (p_outlet_id IS NULL OR ai.outlet_id = p_outlet_id)
    GROUP BY COALESCE(o.code, 'all'), EXTRACT(MONTH FROM ai.invoice_date)
  ),
  -- Costi: electronic_invoices passive aggregate per account
  costs AS (
    SELECT
      COALESCE(o.code, 'all') AS cost_center,
      v_year AS year,
      EXTRACT(MONTH FROM ei.invoice_date)::integer AS month,
      cc.code AS account_code,
      COALESCE(SUM(ei.net_amount), 0)::numeric AS amount,
      'electronic_invoices'::text AS source
    FROM electronic_invoices ei
    JOIN cost_categories cc ON cc.id = ei.cost_category_id
    LEFT JOIN outlets o ON o.id = ei.outlet_id
    WHERE ei.company_id = v_company_id
      AND ei.invoice_date IS NOT NULL
      AND EXTRACT(YEAR FROM ei.invoice_date)::integer = v_year
      AND ei.cost_category_id IS NOT NULL
      AND (p_outlet_id IS NULL OR ei.outlet_id = p_outlet_id)
    GROUP BY COALESCE(o.code, 'all'), EXTRACT(MONTH FROM ei.invoice_date), cc.code
  ),
  all_sources AS (
    SELECT * FROM rev_b2c
    UNION ALL SELECT * FROM rev_b2b
    UNION ALL SELECT * FROM costs
  ),
  totals AS (
    SELECT cost_center, year, month, account_code,
           SUM(amount) AS total,
           jsonb_object_agg(source, amount) AS breakdown
    FROM all_sources
    WHERE amount <> 0
    GROUP BY cost_center, year, month, account_code
  )
  -- UPDATE budget_entries (solo righe esistenti che matchano)
  UPDATE budget_entries be
  SET
    actual_amount = t.total,
    actual_refreshed_at = NOW(),
    actual_breakdown = t.breakdown,
    updated_at = NOW()
  FROM totals t
  WHERE be.company_id = v_company_id
    AND be.cost_center = t.cost_center
    AND be.year = t.year
    AND be.month = t.month
    AND be.account_code = t.account_code
    -- Quando p_outlet_id specificato, limita anche l'UPDATE a quel cost_center
    AND (p_outlet_id IS NULL OR be.cost_center = v_outlet_code);

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  -- Anche le righe che non hanno match nelle sorgenti vanno azzerate per
  -- coerenza (l'utente ha rinfrescato, quindi quel mese è "verificato").
  -- Solo se esiste almeno una riga sorgente per il loro mese.
  UPDATE budget_entries be
  SET
    actual_amount = 0,
    actual_refreshed_at = NOW(),
    actual_breakdown = '{}'::jsonb,
    updated_at = NOW()
  WHERE be.company_id = v_company_id
    AND be.year = v_year
    AND (p_outlet_id IS NULL OR be.cost_center = v_outlet_code)
    AND (be.actual_refreshed_at IS NULL OR be.actual_refreshed_at < NOW() - INTERVAL '1 second')
    AND NOT EXISTS (
      -- Non azzerare righe appena aggiornate dalla CTE sopra
      SELECT 1 FROM (
        SELECT cost_center, year, month, account_code FROM rev_b2c WHERE amount <> 0
        UNION ALL SELECT cost_center, year, month, account_code FROM rev_b2b WHERE amount <> 0
        UNION ALL SELECT cost_center, year, month, account_code FROM costs WHERE amount <> 0
      ) src
      WHERE src.cost_center = be.cost_center
        AND src.year = be.year
        AND src.month = be.month
        AND src.account_code = be.account_code
    );

  -- Totali per response (per UI feedback)
  SELECT COALESCE(SUM(actual_amount), 0) INTO v_total_ricavi
  FROM budget_entries
  WHERE company_id = v_company_id
    AND year = v_year
    AND account_code = v_revenue_account
    AND (p_outlet_id IS NULL OR cost_center = v_outlet_code);

  SELECT COALESCE(SUM(actual_amount), 0) INTO v_total_costi
  FROM budget_entries
  WHERE company_id = v_company_id
    AND year = v_year
    AND account_code <> v_revenue_account
    AND (p_outlet_id IS NULL OR cost_center = v_outlet_code);

  RETURN jsonb_build_object(
    'success', true,
    'rows_updated', v_rows_updated,
    'year', v_year,
    'outlet_id', p_outlet_id,
    'outlet_code', v_outlet_code,
    'total_ricavi_consuntivo', v_total_ricavi,
    'total_costi_consuntivo', v_total_costi,
    'risultato_consuntivo', v_total_ricavi - ABS(v_total_costi),
    'refreshed_at', NOW()
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'sqlstate', SQLSTATE
    );
END;
$$;

COMMENT ON FUNCTION public.refresh_budget_consuntivo(uuid, integer) IS
  'Aggrega consuntivo da daily_revenue + active_invoices + electronic_invoices e UPDATE budget_entries.actual_amount. Bypassato CEO (read-only).';

REVOKE ALL ON FUNCTION public.refresh_budget_consuntivo(uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.refresh_budget_consuntivo(uuid, integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4) Trigger: invalida actual_refreshed_at quando le fonti cambiano
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._invalidate_budget_consuntivo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_outlet_id uuid;
  v_outlet_code text;
  v_date date;
  v_year integer;
  v_month integer;
  v_row record;
BEGIN
  -- Su DELETE usa OLD, altrimenti NEW
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;

  v_company_id := v_row.company_id;
  v_outlet_id := v_row.outlet_id;

  -- Determina la data dal nome della tabella
  IF TG_TABLE_NAME = 'electronic_invoices' THEN
    v_date := v_row.invoice_date;
  ELSIF TG_TABLE_NAME = 'active_invoices' THEN
    v_date := v_row.invoice_date;
  ELSIF TG_TABLE_NAME = 'daily_revenue' THEN
    v_date := v_row.date;
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_date IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_year := EXTRACT(YEAR FROM v_date)::integer;
  v_month := EXTRACT(MONTH FROM v_date)::integer;

  IF v_outlet_id IS NOT NULL THEN
    SELECT code INTO v_outlet_code FROM outlets WHERE id = v_outlet_id;
  ELSE
    v_outlet_code := 'all';
  END IF;

  -- Invalida solo le righe (mese/outlet) interessate
  UPDATE budget_entries
  SET actual_refreshed_at = NULL
  WHERE company_id = v_company_id
    AND year = v_year
    AND month = v_month
    AND cost_center = COALESCE(v_outlet_code, 'all');

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public._invalidate_budget_consuntivo() IS
  'Trigger interno: azzera actual_refreshed_at delle righe budget_entries impattate quando una fonte (electronic_invoices, active_invoices, daily_revenue) cambia.';

DROP TRIGGER IF EXISTS trg_invalidate_consuntivo_electronic_invoices ON electronic_invoices;
CREATE TRIGGER trg_invalidate_consuntivo_electronic_invoices
  AFTER INSERT OR UPDATE OR DELETE ON electronic_invoices
  FOR EACH ROW EXECUTE FUNCTION public._invalidate_budget_consuntivo();

DROP TRIGGER IF EXISTS trg_invalidate_consuntivo_active_invoices ON active_invoices;
CREATE TRIGGER trg_invalidate_consuntivo_active_invoices
  AFTER INSERT OR UPDATE OR DELETE ON active_invoices
  FOR EACH ROW EXECUTE FUNCTION public._invalidate_budget_consuntivo();

DROP TRIGGER IF EXISTS trg_invalidate_consuntivo_daily_revenue ON daily_revenue;
CREATE TRIGGER trg_invalidate_consuntivo_daily_revenue
  AFTER INSERT OR UPDATE OR DELETE ON daily_revenue
  FOR EACH ROW EXECUTE FUNCTION public._invalidate_budget_consuntivo();

-- -----------------------------------------------------------------------------
-- 5) Indici di supporto (idempotenti)
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_budget_entries_lookup
  ON budget_entries (company_id, year, month, cost_center, account_code);

CREATE INDEX IF NOT EXISTS idx_budget_entries_refreshed
  ON budget_entries (company_id, actual_refreshed_at)
  WHERE actual_refreshed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_daily_revenue_company_date
  ON daily_revenue (company_id, outlet_id, date);

CREATE INDEX IF NOT EXISTS idx_active_invoices_company_date
  ON active_invoices (company_id, outlet_id, invoice_date);

CREATE INDEX IF NOT EXISTS idx_electronic_invoices_company_date
  ON electronic_invoices (company_id, outlet_id, invoice_date);

COMMIT;

-- =============================================================================
-- ROLLBACK (script speculare, non eseguito da questa migrazione)
-- =============================================================================
--
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_invalidate_consuntivo_electronic_invoices ON electronic_invoices;
-- DROP TRIGGER IF EXISTS trg_invalidate_consuntivo_active_invoices ON active_invoices;
-- DROP TRIGGER IF EXISTS trg_invalidate_consuntivo_daily_revenue ON daily_revenue;
-- DROP FUNCTION IF EXISTS public._invalidate_budget_consuntivo() CASCADE;
-- DROP FUNCTION IF EXISTS public.refresh_budget_consuntivo(uuid, integer) CASCADE;
-- DROP FUNCTION IF EXISTS public._caller_company_id() CASCADE;
-- DROP INDEX IF EXISTS idx_budget_entries_lookup;
-- DROP INDEX IF EXISTS idx_budget_entries_refreshed;
-- DROP INDEX IF EXISTS idx_daily_revenue_company_date;
-- DROP INDEX IF EXISTS idx_active_invoices_company_date;
-- DROP INDEX IF EXISTS idx_electronic_invoices_company_date;
-- ALTER TABLE budget_entries DROP COLUMN IF EXISTS actual_refreshed_at;
-- ALTER TABLE budget_entries DROP COLUMN IF EXISTS actual_breakdown;
-- COMMIT;
