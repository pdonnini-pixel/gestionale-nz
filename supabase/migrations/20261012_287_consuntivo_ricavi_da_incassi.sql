-- Migrazione 287 — consuntivo ricavi del mese dagli incassi giornalieri (12/10/2026)
--
-- Deciso da Patrizio il 12/10/2026: quando un mese è completo negli incassi
-- giornalieri (daily_revenue), il consuntivo ricavi di quel mese in Budget &
-- Controllo (budget_confronto, entry_type 'cons_monthly', stato 'granitico')
-- si riempie da solo. Prima lo copiava a mano chi caricava: luglio e agosto
-- 2026 coincidono al centesimo con la somma degli incassi.
--
-- Regole:
-- - si riempiono SOLO le celle vuote: un consuntivo già inserito (a mano o
--   prima) non si tocca mai (ON CONFLICT DO NOTHING, e nessun cons_monthly
--   per quell'outlet e mese su qualunque conto);
-- - mese completo = finito da almeno 2 giorni, con incassi in almeno
--   (giorni del mese − 3) giorni, così un mese di apertura parziale resta a chi
--   carica;
-- - solo gli ultimi 3 mesi chiusi: non si riempie la storia;
-- - il conto ricavi è quello che l'outlet usa già in budget_confronto
--   (preventivo o consuntivo dello stesso anno); se non ce n'è, l'outlet si salta.
-- Vale su ogni tenant. Il job notturno è nella migrazione 288.

CREATE OR REPLACE FUNCTION public.fn_consuntivo_ricavi_da_incassi(p_company_id uuid, p_prova boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_oggi date := (now() AT TIME ZONE 'Europe/Rome')::date;
  v_piano jsonb;
  v_n integer := 0;
BEGIN
  WITH mesi AS (
    SELECT date_trunc('month', v_oggi - (k || ' month')::interval)::date AS inizio
    FROM generate_series(1, 3) k
  ),
  inc AS (
    SELECT o.cost_center_key AS cc, m.inizio,
           count(DISTINCT d.date) AS giorni,
           sum(d.net_revenue) AS importo
    FROM mesi m
    JOIN public.daily_revenue d ON d.company_id = p_company_id
         AND d.date >= m.inizio AND d.date < (m.inizio + interval '1 month')
    JOIN public.outlets o ON o.id = d.outlet_id AND o.company_id = p_company_id
    WHERE coalesce(o.cost_center_key, '') <> ''
    GROUP BY o.cost_center_key, m.inizio
  ),
  pronti AS (
    SELECT i.*, EXTRACT(YEAR FROM i.inizio)::int AS anno, EXTRACT(MONTH FROM i.inizio)::int AS mese
    FROM inc i
    WHERE (i.inizio + interval '1 month')::date + 2 <= v_oggi
      AND i.giorni >= EXTRACT(DAY FROM (i.inizio + interval '1 month' - interval '1 day'))::int - 3
      AND NOT EXISTS (SELECT 1 FROM public.budget_confronto bc
                      WHERE bc.company_id = p_company_id AND bc.cost_center = i.cc
                        AND bc.year = EXTRACT(YEAR FROM i.inizio)::int
                        AND bc.month = EXTRACT(MONTH FROM i.inizio)::int
                        AND bc.entry_type = 'cons_monthly')
  ),
  conti AS (
    SELECT DISTINCT ON (bc.cost_center, bc.year) bc.cost_center, bc.year, bc.account_code
    FROM public.budget_confronto bc
    WHERE bc.company_id = p_company_id AND bc.entry_type IN ('rev_monthly', 'cons_monthly')
    GROUP BY bc.cost_center, bc.year, bc.account_code
    ORDER BY bc.cost_center, bc.year, count(*) DESC, bc.account_code
  )
  SELECT jsonb_agg(jsonb_build_object('outlet', p.cc, 'anno', p.anno, 'mese', p.mese,
                                      'conto', c.account_code, 'giorni', p.giorni, 'importo', round(p.importo, 2))
                   ORDER BY p.cc, p.anno, p.mese)
    INTO v_piano
  FROM pronti p
  JOIN conti c ON c.cost_center = p.cc AND c.year = p.anno;

  IF NOT p_prova AND v_piano IS NOT NULL THEN
    INSERT INTO public.budget_confronto (company_id, cost_center, account_code, year, month, entry_type, amount, stato, updated_at)
    SELECT p_company_id, x->>'outlet', x->>'conto', (x->>'anno')::int, (x->>'mese')::int,
           'cons_monthly', (x->>'importo')::numeric, 'granitico', now()
    FROM jsonb_array_elements(v_piano) x
    ON CONFLICT (company_id, cost_center, account_code, year, month, entry_type) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('company_id', p_company_id, 'prova', p_prova, 'inseriti', v_n,
                            'piano', coalesce(v_piano, '[]'::jsonb), 'eseguito_il', now());
END;
$$;
REVOKE ALL ON FUNCTION public.fn_consuntivo_ricavi_da_incassi(uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_consuntivo_ricavi_da_incassi_tutte()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c uuid;
  out jsonb := '[]'::jsonb;
BEGIN
  FOR c IN SELECT DISTINCT company_id FROM public.daily_revenue WHERE company_id IS NOT NULL LOOP
    out := out || jsonb_build_array(public.fn_consuntivo_ricavi_da_incassi(c));
  END LOOP;
  RETURN out;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_consuntivo_ricavi_da_incassi_tutte() FROM PUBLIC, anon, authenticated;
