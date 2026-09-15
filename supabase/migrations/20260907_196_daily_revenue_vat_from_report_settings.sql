-- =====================================================================
-- 196 — Un'unica aliquota IVA per lo scorporo dei corrispettivi
-- ---------------------------------------------------------------------
-- La proiezione delle chiusure in daily_revenue (173) scorporava l'IVA con
-- companies.settings->>'cash_closing_vat_rate' (mai valorizzata), mentre il
-- report serale, il pannello «Obiettivo del mese» e la proposta consuntivo
-- usano daily_report_settings.budget_vat_rate (194, modificabile in
-- Impostazioni → Report incassi serale). Da ora la proiezione legge prima
-- daily_report_settings.budget_vat_rate, poi il vecchio setting, poi 22.
-- Solo funzione, nessuna modifica di schema. Tenant: NZ, Made, Zago.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.project_cash_closing_to_daily_revenue(p_closing_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c        public.outlet_daily_closings%ROWTYPE;
  v_cash   numeric(14,2) := 0;
  v_card   numeric(14,2) := 0;
  v_other  numeric(14,2) := 0;
  v_vat    numeric := 22;
BEGIN
  SELECT * INTO c FROM public.outlet_daily_closings WHERE id = p_closing_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT
    COALESCE(SUM(CASE WHEN ch.kind = 'contanti' THEN l.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ch.kind IN ('pos', 'pos_amex') THEN l.amount ELSE 0 END), 0)
  INTO v_cash, v_card
  FROM public.outlet_daily_closing_lines l
  JOIN public.outlet_payment_channels ch ON ch.id = l.channel_id
  WHERE l.closing_id = c.id;

  v_other := GREATEST(c.total_receipts - v_cash - v_card, 0);

  -- Aliquota per lo scorporo IVA: Impostazioni → Report incassi serale, poi il vecchio
  -- setting aziendale, poi 22 %.
  v_vat := COALESCE(
    (SELECT s.budget_vat_rate FROM public.daily_report_settings s WHERE s.company_id = c.company_id),
    (SELECT NULLIF(co.settings->>'cash_closing_vat_rate', '')::numeric FROM public.companies co WHERE co.id = c.company_id),
    22);

  INSERT INTO public.daily_revenue AS dr
    (company_id, outlet_id, date, gross_revenue, net_revenue, transactions_count,
     avg_ticket, cash_amount, card_amount, other_amount, source, notes)
  VALUES
    (c.company_id, c.outlet_id, c.closing_date, c.total_receipts,
     ROUND(c.total_receipts / (1 + v_vat / 100), 2), 0, 0,
     v_cash, v_card, v_other, 'manuale'::import_source,
     'Chiusura cassa ' || c.id::text)
  ON CONFLICT (company_id, outlet_id, date) DO UPDATE SET
    gross_revenue = EXCLUDED.gross_revenue,
    net_revenue   = EXCLUDED.net_revenue,
    cash_amount   = EXCLUDED.cash_amount,
    card_amount   = EXCLUDED.card_amount,
    other_amount  = EXCLUDED.other_amount,
    source        = EXCLUDED.source,
    notes         = EXCLUDED.notes;
END;
$$;
REVOKE ALL ON FUNCTION public.project_cash_closing_to_daily_revenue(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_cash_closing_to_daily_revenue(uuid) TO service_role;
-- Verifica: SELECT pg_get_functiondef('public.project_cash_closing_to_daily_revenue(uuid)'::regprocedure) ILIKE '%daily_report_settings%';
