-- =====================================================================
-- Migrazione 465 — «Vendite e ingressi»: confronti alla pari
-- =====================================================================
-- Patrizio, 24/11/2026, guardando Barberino a novembre (1-3 caricati):
-- «Cassa −85%» e «−4.616 € sull'anno prima» non si capivano. Erano due
-- confronti sbagliati:
--   * la cassa si sommava su tutto il mese, MODA solo sui giorni caricati:
--     ora la funzione da' l'incasso giorno per giorno (cassa_giorni) e la
--     pagina confronta solo i giorni che MODA ha;
--   * l'anno prima era lo stesso calendario (1-3/11/2025 = sabato, domenica,
--     lunedi') contro domenica, lunedi', martedi': ora e' lo stesso giorno
--     della settimana, 52 settimane prima (364 giorni), come si fa nel retail.
-- Solo CREATE OR REPLACE della funzione della 464, stessi permessi.
-- NO DATA LOSS: nessun dato toccato. Tenant: NZ e Zago.
-- Rollback: rieseguire la funzione della 464.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.vendite_ingressi_report(p_mese date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_role    text := COALESCE(public.get_my_role()::text, '');
  v_outlets uuid[];
  m0 date;
  m1 date;
  p0 date;
  a0 date;
  a1 date;
BEGIN
  IF v_company IS NULL OR p_mese IS NULL THEN
    RAISE EXCEPTION 'Vendite e ingressi: utente o mese mancanti' USING ERRCODE = '42501';
  END IF;

  IF v_role = ANY (ARRAY['super_advisor', 'ceo', 'cfo', 'coo', 'contabile']) THEN
    SELECT COALESCE(array_agg(o.id), '{}') INTO v_outlets
      FROM public.outlets o WHERE o.company_id = v_company;
  ELSIF v_role = 'responsabile' THEN
    SELECT COALESCE(array_agg(DISTINCT c.outlet_id), '{}') INTO v_outlets
      FROM public.attendance_confermatori c
      JOIN public.outlets o ON o.id = c.outlet_id AND o.company_id = v_company
     WHERE c.user_id = auth.uid() AND c.company_id = v_company;
  ELSE
    RAISE EXCEPTION 'Vendite e ingressi: il tuo profilo non vede questa pagina' USING ERRCODE = '42501';
  END IF;

  m0 := date_trunc('month', p_mese)::date;
  m1 := (m0 + interval '1 month')::date;
  p0 := (m0 - interval '1 month')::date;
  -- Anno prima: gli stessi giorni della settimana, 52 settimane (364 giorni) prima.
  a0 := m0 - 364;
  a1 := m1 - 364;

  RETURN jsonb_build_object(
    'mese', to_char(m0, 'YYYY-MM'),
    'solo_suoi', v_role = 'responsabile',
    'negozi', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.name) ORDER BY o.name), '[]'::jsonb)
        FROM public.outlets o
       WHERE o.id = ANY (v_outlets)
         AND EXISTS (SELECT 1 FROM public.outlet_traffic_hourly t WHERE t.outlet_id = o.id)
    ),
    'mesi', (
      SELECT COALESCE(jsonb_agg(x.m ORDER BY x.m DESC), '[]'::jsonb)
        FROM (SELECT DISTINCT to_char(t.data, 'YYYY-MM') AS m
                FROM public.outlet_traffic_hourly t
               WHERE t.company_id = v_company AND t.outlet_id = ANY (v_outlets)) x
    ),
    -- [negozio, data, ingressi, scontrini, pezzi, teorico, reale, costo, importi caricati]
    'giorni', (
      SELECT COALESCE(jsonb_agg(jsonb_build_array(g.outlet_id, g.data, g.i, g.s, g.q, g.l, g.v, g.c, g.ok) ORDER BY g.data, g.outlet_id), '[]'::jsonb)
        FROM (SELECT t.outlet_id, t.data,
                     sum(t.ingressi) AS i, sum(t.scontrini) AS s, sum(t.pezzi) AS q,
                     sum(t.valore_teorico) AS l, sum(t.vendite) AS v, sum(t.costo_acquisto) AS c,
                     bool_and(t.valore_teorico IS NOT NULL) AS ok
                FROM public.outlet_traffic_hourly t
               WHERE t.company_id = v_company AND t.outlet_id = ANY (v_outlets)
                 AND ((t.data >= p0 AND t.data < m1) OR (t.data >= a0 AND t.data < a1))
               GROUP BY t.outlet_id, t.data) g
    ),
    -- [negozio, giorno della settimana 1-7, ora, ingressi, scontrini, reale]
    'ore', (
      SELECT COALESCE(jsonb_agg(jsonb_build_array(h.outlet_id, h.d, h.ora, h.i, h.s, h.v) ORDER BY h.outlet_id, h.d, h.ora), '[]'::jsonb)
        FROM (SELECT t.outlet_id, extract(isodow FROM t.data)::int AS d, t.ora,
                     sum(t.ingressi) AS i, sum(t.scontrini) AS s, sum(t.vendite) AS v
                FROM public.outlet_traffic_hourly t
               WHERE t.company_id = v_company AND t.outlet_id = ANY (v_outlets)
                 AND t.data >= m0 AND t.data < m1
               GROUP BY t.outlet_id, extract(isodow FROM t.data), t.ora) h
    ),
    -- [negozio, giorno, incasso netto delle chiusure di cassa]: il confronto si fa sui soli giorni che MODA ha
    'cassa_giorni', (
      SELECT COALESCE(jsonb_agg(jsonb_build_array(d.outlet_id, d.date, d.net_revenue)), '[]'::jsonb)
        FROM public.daily_revenue d
       WHERE d.company_id = v_company AND d.outlet_id = ANY (v_outlets)
         AND d.date >= m0 AND d.date < m1
    ),
    -- [negozio, incasso netto delle chiusure di cassa del mese, giorni]
    'cassa', (
      SELECT COALESCE(jsonb_agg(jsonb_build_array(k.outlet_id, k.n, k.g)), '[]'::jsonb)
        FROM (SELECT d.outlet_id, sum(d.net_revenue) AS n, count(*) AS g
                FROM public.daily_revenue d
               WHERE d.company_id = v_company AND d.outlet_id = ANY (v_outlets)
                 AND d.date >= m0 AND d.date < m1
               GROUP BY d.outlet_id) k
    )
  );
END;
$$;

COMMENT ON FUNCTION public.vendite_ingressi_report(date) IS
  'Report «Vendite e ingressi» del mese (migration 464, confronti alla pari 465). Profili di amministrazione: tutta l''azienda; responsabile: solo i suoi negozi (attendance_confermatori).';
REVOKE ALL ON FUNCTION public.vendite_ingressi_report(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.vendite_ingressi_report(date) TO authenticated, service_role;

COMMIT;
