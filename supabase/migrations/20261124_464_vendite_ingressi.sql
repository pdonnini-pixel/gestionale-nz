-- =====================================================================
-- Migrazione 464 — «Vendite e ingressi»: tutto il report MODA, codici
-- negozio ricordati, report per mese con il recinto delle responsabili
-- =====================================================================
-- Decisioni di Patrizio del 24/11/2026:
--   * Una sezione sua, «Vendite e ingressi», dove Sabrina (New Zago) e
--     Veronica (Zago) trascinano ogni mese il report MODA «Statistica
--     Situazione Vendite con Conversion Rate» per giorno e ora.
--   * Del report si tiene tutto, non solo ingressi e scontrini: pezzi,
--     valore teorico (listino), valore reale (incassato), costo d'acquisto.
--     Tutti gli importi sono IMPONIBILI (senza IVA). Il valore reale va
--     nella colonna vendite, che c'era gia' (320). Sconto, prezzo medio,
--     pezzi per scontrino, ricarichi e resa si calcolano, non si salvano.
--   * Ricaricare un file non somma niente: si sostituisce ora per ora
--     (la chiave unica outlet_id, data, ora c'e' dalla 320).
--   * Le responsabili vedono tutto, ma solo del loro negozio.
--
-- COSA FA
--   1. outlet_traffic_hourly: pezzi, valore_teorico, costo_acquisto.
--      NULL = importi non ancora caricati per quell'ora (i report caricati
--      fino a oggi avevano solo ingressi e scontrini). Nessun backfill: i
--      numeri arrivano ricaricando i PDF.
--   2. outlet_moda_codici: il negozio del gestionale per ogni codice MODA
--      (BARB, BRU5, FIR2...). Si scrive la prima volta che chi carica
--      sceglie a mano il negozio; poi il caricamento lo riconosce da solo.
--      Serve soprattutto a Zago, i cui codici MODA non conosciamo ancora.
--   3. vendite_ingressi_report(p_mese): giorni del mese, del mese prima e
--      dello stesso mese dell'anno prima, ore per giorno della settimana,
--      incassi netti delle chiusure di cassa. SECURITY DEFINER perche' la
--      responsabile e' chiusa fuori da tutte le tabelle (378): la funzione
--      le da' solo i negozi suoi (attendance_confermatori, come
--      responsabile_negozi). Gli altri profili ammessi vedono tutta
--      l'azienda; dipendente, operatore di cassa e il resto no.
--
-- NO DATA LOSS: solo colonne nuove, una tabella nuova, una funzione.
-- Tenant: NZ e Zago. Rollback: 20261124_464_vendite_ingressi_ROLLBACK.sql
-- =====================================================================

BEGIN;

-- 1. Tutte le colonne del report
ALTER TABLE public.outlet_traffic_hourly
  ADD COLUMN IF NOT EXISTS pezzi integer,
  ADD COLUMN IF NOT EXISTS valore_teorico numeric(12,2),
  ADD COLUMN IF NOT EXISTS costo_acquisto numeric(12,2);

COMMENT ON COLUMN public.outlet_traffic_hourly.ingressi IS 'MODA N.P.: persone entrate (contapersone).';
COMMENT ON COLUMN public.outlet_traffic_hourly.vendite IS 'MODA Valore Vendite Reale: incassato, imponibile (senza IVA). Vale solo dove valore_teorico non e'' NULL.';
COMMENT ON COLUMN public.outlet_traffic_hourly.pezzi IS 'MODA Qta Vend: pezzi venduti. NULL = importi non caricati (migration 464).';
COMMENT ON COLUMN public.outlet_traffic_hourly.valore_teorico IS 'MODA Valore Vendite Teorico: a prezzo di listino, imponibile. NULL = importi non caricati (migration 464).';
COMMENT ON COLUMN public.outlet_traffic_hourly.costo_acquisto IS 'MODA V.Acq: costo d''acquisto della merce venduta, a costo medio, imponibile. NULL = importi non caricati (migration 464).';

-- 2. I codici negozio di MODA
CREATE TABLE IF NOT EXISTS public.outlet_moda_codici (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  codice      text NOT NULL CHECK (codice ~ '^[A-Z][A-Z0-9]{1,9}$'),
  descrizione text,
  outlet_id   uuid NOT NULL REFERENCES public.outlets(id),
  created_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, codice)
);
COMMENT ON TABLE public.outlet_moda_codici IS
  'Il negozio del gestionale per ogni codice negozio del report MODA Conversion Rate. Scritto quando chi carica sceglie il negozio a mano (migration 464).';

ALTER TABLE public.outlet_moda_codici ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outlet_moda_codici_select ON public.outlet_moda_codici;
CREATE POLICY outlet_moda_codici_select ON public.outlet_moda_codici FOR SELECT
  USING (company_id = (SELECT public.get_my_company_id()));
DROP POLICY IF EXISTS outlet_moda_codici_write ON public.outlet_moda_codici;
CREATE POLICY outlet_moda_codici_write ON public.outlet_moda_codici FOR ALL
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()));

DROP POLICY IF EXISTS cash_operator_block ON public.outlet_moda_codici;
CREATE POLICY cash_operator_block ON public.outlet_moda_codici AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
DROP POLICY IF EXISTS dipendente_block ON public.outlet_moda_codici;
CREATE POLICY dipendente_block ON public.outlet_moda_codici AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');
DROP POLICY IF EXISTS responsabile_block ON public.outlet_moda_codici;
CREATE POLICY responsabile_block ON public.outlet_moda_codici AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlet_moda_codici TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlet_moda_codici TO service_role;

-- 3. Il report del mese
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
  a0 := (m0 - interval '1 year')::date;
  a1 := (a0 + interval '1 month')::date;

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
  'Report «Vendite e ingressi» del mese (migration 464). Profili di amministrazione: tutta l''azienda; responsabile: solo i suoi negozi (attendance_confermatori).';
REVOKE ALL ON FUNCTION public.vendite_ingressi_report(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.vendite_ingressi_report(date) TO authenticated, service_role;

COMMIT;
