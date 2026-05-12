-- =============================================================================
-- Migrazione 016 — refresh_budget_consuntivo: bypass trigger lock per consuntivo
-- =============================================================================
--
-- Bug fix scoperto durante test UI (12/05/2026):
-- Chiamando refresh_budget_consuntivo su un outlet con preventivo APPROVATO
-- (is_approved=true) il trigger BEFORE UPDATE budget_entries_lock_check
-- bloccava con: "Riga budget approvata: usa la RPC unlock_budget_outlet_year".
--
-- Root cause: il trigger blocca QUALSIASI update su righe approvate, ma il
-- consuntivo (actual_amount/actual_refreshed_at/actual_breakdown) e' un
-- campo OSSERVATIVO, non parte del preventivo lockato. Aggiornarlo non
-- viola l'approvazione del preventivo.
--
-- Fix: usare il bypass gia' esistente (session variable
-- 'app.budget_bypass_lock') per la durata della transazione corrente.
-- set_config(..., true) limita lo scope alla transazione, niente leak.
--
-- Backlog post-go-live: rifinire budget_entries_lock_check per bloccare solo
-- modifiche ai campi del preventivo (budget_amount, is_approved, ecc.) e
-- non a quelli del consuntivo. Per ora il bypass mirato e' adeguato.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.refresh_budget_consuntivo(
  p_outlet_id uuid DEFAULT NULL,
  p_year integer DEFAULT NULL
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
  v_role := COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '');
  IF v_role = 'ceo' THEN
    RAISE EXCEPTION 'Role ceo cannot refresh consuntivo (read-only executive)'
      USING HINT = 'Chiedi a contabile/super_advisor di aggiornare il consuntivo';
  END IF;

  v_company_id := public._caller_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No company associated with caller — login required';
  END IF;

  v_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::integer);

  IF p_outlet_id IS NOT NULL THEN
    SELECT code INTO v_outlet_code FROM outlets
      WHERE id = p_outlet_id AND company_id = v_company_id;
    IF v_outlet_code IS NULL THEN
      RAISE EXCEPTION 'Outlet % not found in current tenant', p_outlet_id;
    END IF;
  END IF;

  -- FIX 016: bypass del trigger budget_entries_lock_check.
  -- Il consuntivo (actual_amount) e' osservativo, non parte del preventivo
  -- lockato dall'approvazione. set_config(..., true) limita lo scope alla
  -- transazione corrente, evitando leak verso altre query.
  PERFORM set_config('app.budget_bypass_lock', 'on', true);

  WITH
  rev_b2c AS (
    SELECT COALESCE(o.code, 'all') AS cost_center, v_year AS year,
           EXTRACT(MONTH FROM dr.date)::integer AS month, v_revenue_account AS account_code,
           COALESCE(SUM(dr.net_revenue), 0)::numeric AS amount, 'daily_revenue'::text AS source
    FROM daily_revenue dr LEFT JOIN outlets o ON o.id = dr.outlet_id
    WHERE dr.company_id = v_company_id
      AND EXTRACT(YEAR FROM dr.date)::integer = v_year
      AND (p_outlet_id IS NULL OR dr.outlet_id = p_outlet_id)
    GROUP BY COALESCE(o.code, 'all'), EXTRACT(MONTH FROM dr.date)
  ),
  rev_b2b AS (
    SELECT COALESCE(o.code, 'all') AS cost_center, v_year AS year,
           EXTRACT(MONTH FROM ai.invoice_date)::integer AS month, v_revenue_account AS account_code,
           COALESCE(SUM(ai.taxable_amount), 0)::numeric AS amount, 'active_invoices'::text AS source
    FROM active_invoices ai LEFT JOIN outlets o ON o.id = ai.outlet_id
    WHERE ai.company_id = v_company_id
      AND EXTRACT(YEAR FROM ai.invoice_date)::integer = v_year
      AND (p_outlet_id IS NULL OR ai.outlet_id = p_outlet_id)
    GROUP BY COALESCE(o.code, 'all'), EXTRACT(MONTH FROM ai.invoice_date)
  ),
  costs AS (
    SELECT COALESCE(o.code, 'all') AS cost_center, v_year AS year,
           EXTRACT(MONTH FROM ei.invoice_date)::integer AS month, cc.code AS account_code,
           COALESCE(SUM(ei.net_amount), 0)::numeric AS amount, 'electronic_invoices'::text AS source
    FROM electronic_invoices ei
    JOIN cost_categories cc ON cc.id = ei.cost_category_id
    LEFT JOIN outlets o ON o.id = ei.outlet_id
    WHERE ei.company_id = v_company_id AND ei.invoice_date IS NOT NULL
      AND EXTRACT(YEAR FROM ei.invoice_date)::integer = v_year
      AND ei.cost_category_id IS NOT NULL
      AND (p_outlet_id IS NULL OR ei.outlet_id = p_outlet_id)
    GROUP BY COALESCE(o.code, 'all'), EXTRACT(MONTH FROM ei.invoice_date), cc.code
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

  -- Step 2 (da 015): marca righe rimaste come verificate
  UPDATE budget_entries
  SET actual_refreshed_at = NOW(), updated_at = NOW()
  WHERE company_id = v_company_id
    AND year = v_year
    AND (p_outlet_id IS NULL OR cost_center = v_outlet_code)
    AND actual_refreshed_at IS NULL;

  SELECT COALESCE(SUM(actual_amount), 0) INTO v_total_ricavi
  FROM budget_entries
  WHERE company_id = v_company_id AND year = v_year
    AND account_code = v_revenue_account
    AND (p_outlet_id IS NULL OR cost_center = v_outlet_code);

  SELECT COALESCE(SUM(actual_amount), 0) INTO v_total_costi
  FROM budget_entries
  WHERE company_id = v_company_id AND year = v_year
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
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
END;
$$;
