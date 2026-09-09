-- 203 — Obiettivo giornaliero pesato per giorno della settimana
--
-- Il budget ricavi del mese (Inserimento rapido, netto IVA → lordo con l'aliquota di
-- daily_report_settings) viene distribuito sui giorni del mese con un PESO per
-- outlet × stagione × tipo di giorno (lun…dom, festivo), ricavato dagli ultimi 12 mesi
-- di daily_revenue: indice = incasso del giorno / incasso medio dei giorni aperti di quel
-- mese (solo mesi con almeno 15 giorni). Catena di fallback quando mancano dati
-- (almeno 4 osservazioni): outlet+stagione+giorno → outlet+giorno → azienda+stagione+giorno
-- → azienda+giorno → 1. I giorni «negozio chiuso» già registrati escono dal riparto.
--
-- Stagione alta = giugno, luglio, agosto, dicembre (i feriali pesano di più);
-- bassa = gli altri mesi (il fatturato si concentra nel weekend).
--
-- Usata da: Chiusura cassa (scostamento serale), Incassi giornalieri (Obiettivo del mese),
-- daily-cash-report-send (report serale). Applicata su NZ → Made → Zago.
BEGIN;

-- Pasqua (algoritmo di Meeus/Jones/Butcher)
CREATE OR REPLACE FUNCTION public.fn_it_easter(p_year integer)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  a int := p_year % 19; b int := p_year / 100; c int := p_year % 100;
  d int; e int; f int; g int; h int; i int; k int; l int; m int;
BEGIN
  d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  RETURN make_date(p_year, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
END;
$$;

-- Tipo di giorno: 'fest' per le festività nazionali italiane, altrimenti lun…dom
CREATE OR REPLACE FUNCTION public.fn_revenue_day_type(p_day date)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN (extract(month FROM p_day), extract(day FROM p_day)) IN ((1,1),(1,6),(4,25),(5,1),(6,2),(8,15),(11,1),(12,8),(12,25),(12,26))
      OR p_day = public.fn_it_easter(extract(year FROM p_day)::int)
      OR p_day = public.fn_it_easter(extract(year FROM p_day)::int) + 1
    THEN 'fest'
    ELSE (ARRAY['lun','mar','mer','gio','ven','sab','dom'])[extract(isodow FROM p_day)::int]
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_revenue_season(p_day date)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN extract(month FROM p_day) IN (6, 7, 8, 12) THEN 'alta' ELSE 'bassa' END;
$$;

-- Obiettivo per outlet e giorno nell'intervallo richiesto.
-- SECURITY DEFINER: legge budget e ricavi storici anche per l'operatore cassa, che non
-- vede quelle tabelle; l'accesso è limitato alla propria azienda e ai propri outlet.
CREATE OR REPLACE FUNCTION public.get_outlet_day_targets(p_company_id uuid, p_from date, p_to date)
RETURNS TABLE (
  outlet_id uuid,
  day date,
  day_type text,
  season text,
  weight numeric,
  weight_source text,
  month_gross numeric,
  target numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH auth_ok AS (
    -- service role (edge function), connessione diretta senza JWT (MCP / psql) o utente dell'azienda
    SELECT COALESCE(current_setting('request.jwt.claims', true), '') = ''
        OR (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role'
        OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.company_id = p_company_id) AS ok
  ),
  vat AS (
    SELECT COALESCE(
      (SELECT s.budget_vat_rate FROM public.daily_report_settings s WHERE s.company_id = p_company_id),
      (SELECT NULLIF(co.settings->>'cash_closing_vat_rate', '')::numeric FROM public.companies co WHERE co.id = p_company_id),
      22) AS rate
  ),
  outlets AS (
    SELECT o.id, o.cost_center_key
    FROM public.outlets o, auth_ok
    WHERE auth_ok.ok AND o.company_id = p_company_id AND o.is_active
      AND lower(COALESCE(o.outlet_type, '')) NOT IN ('sede', 'magazzino', 'warehouse', 'hq', 'ufficio')
      AND (auth.uid() IS NULL OR public.has_outlet_access(o.id))
  ),
  -- storico: 12 mesi pieni prima del mese di p_from
  hist AS (
    SELECT dr.outlet_id, dr.date, dr.gross_revenue::numeric AS g, date_trunc('month', dr.date)::date AS ym
    FROM public.daily_revenue dr
    WHERE dr.company_id = p_company_id AND COALESCE(dr.gross_revenue, 0) > 0
      AND dr.date >= (date_trunc('month', p_from::timestamp) - interval '12 months')::date
      AND dr.date <  date_trunc('month', p_from::timestamp)::date
  ),
  om AS (
    SELECT outlet_id, ym, avg(g) AS m FROM hist GROUP BY outlet_id, ym HAVING count(*) >= 15
  ),
  idx AS (
    SELECT h.outlet_id, h.g / om.m AS ix, public.fn_revenue_day_type(h.date) AS dt, public.fn_revenue_season(h.date) AS s
    FROM hist h JOIN om ON om.outlet_id = h.outlet_id AND om.ym = h.ym
  ),
  w1 AS (SELECT outlet_id, s, dt, avg(ix) AS w, count(*) AS n FROM idx GROUP BY 1, 2, 3),
  w2 AS (SELECT outlet_id, dt, avg(ix) AS w, count(*) AS n FROM idx GROUP BY 1, 2),
  w3 AS (SELECT s, dt, avg(ix) AS w, count(*) AS n FROM idx GROUP BY 1, 2),
  w4 AS (SELECT dt, avg(ix) AS w, count(*) AS n FROM idx GROUP BY 1),
  -- tutti i giorni dei mesi toccati dall'intervallo (servono per la somma dei pesi del mese)
  month_days AS (
    SELECT o.id AS outlet_id, o.cost_center_key, d::date AS day
    FROM outlets o
    CROSS JOIN generate_series(date_trunc('month', p_from::timestamp)::date,
                               (date_trunc('month', p_to::timestamp) + interval '1 month - 1 day')::date,
                               interval '1 day') AS d
  ),
  weighted AS (
    SELECT md.outlet_id, md.cost_center_key, md.day,
      public.fn_revenue_day_type(md.day) AS dt, public.fn_revenue_season(md.day) AS s,
      CASE WHEN EXISTS (SELECT 1 FROM public.outlet_daily_closings c WHERE c.outlet_id = md.outlet_id AND c.closing_date = md.day AND c.is_closed_day) THEN 0
           ELSE COALESCE(
             (SELECT w1.w FROM w1 WHERE w1.outlet_id = md.outlet_id AND w1.s = public.fn_revenue_season(md.day) AND w1.dt = public.fn_revenue_day_type(md.day) AND w1.n >= 4),
             (SELECT w2.w FROM w2 WHERE w2.outlet_id = md.outlet_id AND w2.dt = public.fn_revenue_day_type(md.day) AND w2.n >= 4),
             (SELECT w3.w FROM w3 WHERE w3.s = public.fn_revenue_season(md.day) AND w3.dt = public.fn_revenue_day_type(md.day) AND w3.n >= 4),
             (SELECT w4.w FROM w4 WHERE w4.dt = public.fn_revenue_day_type(md.day) AND w4.n >= 4),
             1) END AS w,
      CASE WHEN EXISTS (SELECT 1 FROM public.outlet_daily_closings c WHERE c.outlet_id = md.outlet_id AND c.closing_date = md.day AND c.is_closed_day) THEN 'chiuso'
           WHEN EXISTS (SELECT 1 FROM w1 WHERE w1.outlet_id = md.outlet_id AND w1.s = public.fn_revenue_season(md.day) AND w1.dt = public.fn_revenue_day_type(md.day) AND w1.n >= 4) THEN 'outlet_stagione'
           WHEN EXISTS (SELECT 1 FROM w2 WHERE w2.outlet_id = md.outlet_id AND w2.dt = public.fn_revenue_day_type(md.day) AND w2.n >= 4) THEN 'outlet'
           WHEN EXISTS (SELECT 1 FROM w3 WHERE w3.s = public.fn_revenue_season(md.day) AND w3.dt = public.fn_revenue_day_type(md.day) AND w3.n >= 4) THEN 'azienda_stagione'
           WHEN EXISTS (SELECT 1 FROM w4 WHERE w4.dt = public.fn_revenue_day_type(md.day) AND w4.n >= 4) THEN 'azienda'
           ELSE 'uniforme' END AS src
    FROM month_days md
  ),
  month_sum AS (
    SELECT outlet_id, date_trunc('month', day)::date AS ym, sum(w) AS sw FROM weighted GROUP BY 1, 2
  ),
  budget AS (
    SELECT b.cost_center, b.year, b.month, sum(b.amount)::numeric * (1 + (SELECT rate FROM vat) / 100) AS gross
    FROM public.budget_confronto b
    WHERE b.company_id = p_company_id AND b.entry_type = 'rev_monthly'
    GROUP BY 1, 2, 3
  )
  SELECT w.outlet_id, w.day, w.dt, w.s,
    round(w.w, 4) AS weight, w.src AS weight_source,
    round(b.gross, 2) AS month_gross,
    CASE WHEN b.gross IS NULL OR ms.sw <= 0 THEN NULL ELSE round(b.gross * w.w / ms.sw, 2) END AS target
  FROM weighted w
  JOIN month_sum ms ON ms.outlet_id = w.outlet_id AND ms.ym = date_trunc('month', w.day)::date
  LEFT JOIN budget b ON b.cost_center = w.cost_center_key
    AND b.year = extract(year FROM w.day)::int AND b.month = extract(month FROM w.day)::int
  WHERE w.day BETWEEN p_from AND p_to
  ORDER BY w.outlet_id, w.day;
$$;

REVOKE ALL ON FUNCTION public.get_outlet_day_targets(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_outlet_day_targets(uuid, date, date) TO authenticated, service_role;

COMMIT;

-- Verifica:
-- SELECT public.fn_it_easter(2026);  -- 2026-04-05
-- SELECT o.name, t.day, t.day_type, t.season, t.weight, t.weight_source, t.target
-- FROM public.get_outlet_day_targets('<company_id>', '2026-09-01', '2026-09-30') t JOIN public.outlets o ON o.id = t.outlet_id ORDER BY 1, 2;
