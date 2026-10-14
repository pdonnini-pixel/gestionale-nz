-- Migrazione 306 — il negozio della singola fattura, letto dal documento (14/10/2026)
--
-- Chiesto da Patrizio il 14/10/2026 dopo il confronto con il file di Sabrina
-- per lo Studio Poli (fatture d'acquisto di settembre 2026): Sabrina mette
-- ogni fattura sul negozio a cui si riferisce, il gestionale applicava a tutte
-- le fatture di un fornitore le stesse quote (la media dei 12 mesi). Una
-- bolletta del contatore di Torino finiva divisa su tutti i negozi, un ordine
-- Amazon spedito a Valdichiana anche.
--
-- Il riparto notturno (fn_riparto_automatico) sa già leggere il documento:
-- POD/PDR delle bollette, luogo delle trasferte, outlet nominato nelle righe.
-- Usava queste letture solo per calcolare la media del fornitore. Ora le
-- stesse letture valgono per la singola fattura:
--
-- 1. invoice_outlet_auto: per ogni fattura l'outlet letto dal documento, con
--    i tre metodi del riparto (stesse espressioni della 285):
--      outlet_contatore  tutti i POD/PDR della bolletta portano a un outlet solo
--      outlet_luogo      il luogo della trasferta porta a un outlet solo
--      outlet_nominato   le righe nominano un outlet solo
--    Solo lettura del documento: nessuna decisione. Tabella derivata, la
--    scrive soltanto fn_negozio_per_fattura. Ogni fattura si legge una volta
--    (anche quando non nomina niente: riga con i tre campi vuoti), perché
--    alcune fatture di merce superano il milione di caratteri e rileggerle
--    tutte ogni notte costa minuti. Una volta a settimana si rilegge tutto,
--    per seguire nuovi contatori, luoghi o outlet. Nessun DELETE: la riga
--    sparisce solo con la fattura (ON DELETE CASCADE).
-- 2. v_negozio_fattura: il negozio di una fattura, una riga per fattura.
--      a. classificazione a mano (invoice_cost_overrides), vince sempre;
--      b. outlet letto dal documento, ma SOLO se il fornitore segue il
--         riparto automatico: centro di costo «all», regola assente o scritta
--         dal sistema («Automatica: …», created_by NULL). Un centro di costo o
--         una regola messi da una persona («Diretto», «Deciso da Patrizio…»)
--         non si toccano. La merce e mezzi e carburante restano sul
--         preventivo acquisti (decisione di Patrizio, migrazioni 273 e 281):
--         la merce nomina il luogo di consegna, non il negozio che la vende.
--         Metodo per categoria: energia → contatore, poi nominato;
--         trasferte (VIAGGI) → luogo, poi nominato; resto → nominato.
--    Le condizioni si controllano alla lettura: se in Fornitori si mette una
--    regola a mano, vale subito, senza aspettare la notte.
--    Senza riga in questa vista vale il riparto del fornitore, come prima.
-- 3. v_costi_outlet_da_fatture usa v_negozio_fattura al posto di
--    invoice_cost_overrides per l'outlet (il gruppo «allestimenti» resta
--    della classificazione a mano). Il resto è identico alla 297.
-- 4. Job «negozio-per-fattura-notturno» alle 02:55 UTC (dopo il riparto
--    delle 02:40): legge le fatture nuove. Job «negozio-per-fattura-settimanale»
--    la domenica alle 03:15 UTC: rilegge tutte le fatture.
--    Il primo riempimento non è in questa migrazione (durerebbe minuti): si
--    chiama fn_negozio_per_fattura(company_id, false, 200) finché non legge
--    zero fatture.
--
-- Nessun nome, id o P.IVA scritto a mano: vale su ogni tenant. Solo aggiunte
-- e sostituzione di una vista. Rollback: 20261014_306_..._ROLLBACK.sql.

-- ── 1. Tabella ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_outlet_auto (
  invoice_id        uuid PRIMARY KEY REFERENCES public.electronic_invoices(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  outlet_contatore  uuid REFERENCES public.outlets(id),
  outlet_luogo      uuid REFERENCES public.outlets(id),
  outlet_nominato   uuid REFERENCES public.outlets(id),
  calcolato_il      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_outlet_auto_company_idx ON public.invoice_outlet_auto (company_id);
COMMENT ON TABLE public.invoice_outlet_auto IS
  'Outlet letto dal documento di ogni fattura passiva (POD/PDR, luogo della trasferta, outlet nominato). Derivata: la scrive fn_negozio_per_fattura. Usata da v_negozio_fattura. Migrazione 306.';

ALTER TABLE public.invoice_outlet_auto ENABLE ROW LEVEL SECURITY;
-- Solo lettura per gli utenti: scrive soltanto la funzione (SECURITY DEFINER).
CREATE POLICY company_isolation_select ON public.invoice_outlet_auto FOR SELECT
  USING (company_id = (SELECT public.get_my_company_id()));

-- ── 2. Calcolo (sola lettura) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_negozio_per_fattura_calcolo(p_company_id uuid, p_tutte boolean DEFAULT false, p_limite int DEFAULT NULL)
RETURNS TABLE (invoice_id uuid, outlet_contatore uuid, outlet_luogo uuid, outlet_nominato uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH inv AS (
    SELECT e.id,
           public.fn_testo_fattura_ricercabile(e.xml_content) AS txt,
           lower(coalesce(
             substring(e.xml_content from '<CedentePrestatore>.*?<Email>([^<]+)</Email>.*?</CedentePrestatore>'),
             substring(e.xml_content from '"cedente_prestatore": \{.*?"email": "([^"]*)"'), '')) AS email,
           s.citta, s.comune, s.provincia
    FROM public.electronic_invoices e
    LEFT JOIN LATERAL (
      SELECT p.supplier_id FROM public.payables p
      WHERE p.electronic_invoice_id = e.id AND p.supplier_id IS NOT NULL
      LIMIT 1
    ) p ON true
    LEFT JOIN public.suppliers s ON s.id = p.supplier_id
    WHERE e.company_id = p_company_id
      AND coalesce(e.xml_content, '') <> ''
      AND coalesce(e.tipo_documento, 'TD01') NOT IN ('TD16', 'TD17', 'TD18')
      AND (p_tutte OR NOT EXISTS (SELECT 1 FROM public.invoice_outlet_auto a WHERE a.invoice_id = e.id))
    ORDER BY e.invoice_date DESC NULLS LAST, e.id
    LIMIT p_limite
  ),
  -- Parole che identificano ogni outlet attivo: come il passo 2 del riparto
  kw AS (
    SELECT o.id AS outlet_id,
      (SELECT string_agg(DISTINCT w, '|')
         FROM unnest(regexp_split_to_array(lower(concat_ws(' ', o.name, o.city, o.mall_name)), '[^a-zà-ù]+')) w
        WHERE length(w) >= 5
          AND w NOT IN ('outlet','village','fashion','store','magazzino','ufficio','negozio','punto','vendita',
                        'centro','commerciale','shopping','designer','luxury','sede','della','delle')) AS kw
    FROM public.outlets o
    WHERE o.company_id = p_company_id AND o.is_active
  ),
  tp AS (
    SELECT t.outlet_id, t.kind, lower(t.place) AS place
    FROM public.outlet_travel_places t
    JOIN public.outlets o ON o.id = t.outlet_id AND o.is_active
    WHERE t.company_id = p_company_id
  ),
  r AS (
    SELECT i.id,
      -- Contatore: tutti i POD/PDR noti e tutti dello stesso outlet
      (SELECT CASE WHEN count(*) > 0 AND bool_and(u.outlet_id IS NOT NULL) AND count(DISTINCT u.outlet_id) = 1
                   THEN min(u.outlet_id::text)::uuid END
         FROM (SELECT DISTINCT m[1] AS code
                 FROM regexp_matches(upper(i.txt), '(IT[0-9]{3}E[0-9A-Z]{8,9}|(?<![0-9])[0-9]{14}(?![0-9]))', 'g') m) k
         LEFT JOIN public.utility_supply_points u ON u.company_id = p_company_id AND u.code = k.code) AS outlet_contatore,
      -- Luogo: righe, poi email del cedente, poi città e provincia del fornitore
      (SELECT CASE WHEN cardinality(z.a) = 1 THEN z.a[1] END
         FROM (SELECT coalesce(
                 nullif(array(SELECT DISTINCT tp.outlet_id FROM tp
                               WHERE tp.kind = 'comune' AND i.txt ~ ('\m' || tp.place || '\M')), '{}'),
                 nullif(array(SELECT DISTINCT tp.outlet_id FROM tp
                               WHERE tp.kind = 'comune' AND i.email ~ ('\m' || tp.place || '\M')), '{}'),
                 array(SELECT DISTINCT tp.outlet_id FROM tp
                        WHERE (tp.kind = 'comune' AND lower(concat_ws(' ', i.citta, i.comune)) ~ ('\m' || tp.place || '\M'))
                           OR (tp.kind = 'provincia' AND upper(trim(coalesce(i.provincia, ''))) = upper(tp.place)))) AS a) z) AS outlet_luogo,
      -- Nominato: le righe nominano un outlet solo
      (SELECT CASE WHEN count(*) = 1 THEN min(k.outlet_id::text)::uuid END
         FROM kw k
        WHERE k.kw IS NOT NULL AND i.txt ~ ('\m(' || k.kw || ')\M')) AS outlet_nominato
    FROM inv i
  )
  SELECT r.id, r.outlet_contatore, r.outlet_luogo, r.outlet_nominato
  FROM r;
$$;
REVOKE ALL ON FUNCTION public.fn_negozio_per_fattura_calcolo(uuid, boolean, int) FROM PUBLIC, anon, authenticated;

-- ── 3. Scrittura per un'azienda ───────────────────────────────────────────
-- p_tutte = false: solo le fatture mai lette; true: rilegge tutte.
-- p_limite: quante fatture al massimo (per il primo riempimento a blocchi).
CREATE OR REPLACE FUNCTION public.fn_negozio_per_fattura(p_company_id uuid, p_tutte boolean DEFAULT false, p_limite int DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lette   int := 0;
  v_cambiate int := 0;
BEGIN
  WITH c AS MATERIALIZED (
    SELECT * FROM public.fn_negozio_per_fattura_calcolo(p_company_id, p_tutte, p_limite)
  ),
  w AS (
    INSERT INTO public.invoice_outlet_auto AS a (invoice_id, company_id, outlet_contatore, outlet_luogo, outlet_nominato, calcolato_il)
    SELECT c.invoice_id, p_company_id, c.outlet_contatore, c.outlet_luogo, c.outlet_nominato, now()
    FROM c
    ON CONFLICT (invoice_id) DO UPDATE
      SET outlet_contatore = EXCLUDED.outlet_contatore,
          outlet_luogo     = EXCLUDED.outlet_luogo,
          outlet_nominato  = EXCLUDED.outlet_nominato,
          calcolato_il     = now()
      WHERE (a.outlet_contatore, a.outlet_luogo, a.outlet_nominato)
            IS DISTINCT FROM (EXCLUDED.outlet_contatore, EXCLUDED.outlet_luogo, EXCLUDED.outlet_nominato)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM c), (SELECT count(*) FROM w) INTO v_lette, v_cambiate;

  RETURN jsonb_build_object('company_id', p_company_id, 'lette', v_lette, 'scritte_o_cambiate', v_cambiate);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_negozio_per_fattura(uuid, boolean, int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_negozio_per_fattura_tutte(p_tutte boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c uuid;
  out jsonb := '[]'::jsonb;
BEGIN
  FOR c IN SELECT DISTINCT company_id FROM public.electronic_invoices WHERE company_id IS NOT NULL LOOP
    out := out || jsonb_build_array(public.fn_negozio_per_fattura(c, p_tutte));
  END LOOP;
  RETURN out;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_negozio_per_fattura_tutte(boolean) FROM PUBLIC, anon, authenticated;

-- ── 4. Il negozio di una fattura ──────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_negozio_fattura WITH (security_invoker = on) AS
SELECT ov.company_id, ov.invoice_id, ov.outlet_id, 'classificata'::text AS fonte
FROM public.invoice_cost_overrides ov
UNION ALL
SELECT a.company_id, a.invoice_id, x.outlet_id, x.fonte
FROM public.invoice_outlet_auto a
JOIN LATERAL (
  SELECT p.supplier_id FROM public.payables p
  WHERE p.electronic_invoice_id = a.invoice_id AND p.supplier_id IS NOT NULL
  LIMIT 1
) p ON true
JOIN public.suppliers s ON s.id = p.supplier_id
LEFT JOIN public.cost_categories c ON c.id = s.default_cost_category_id
LEFT JOIN LATERAL (
  SELECT r.description, r.created_by FROM public.supplier_allocation_rules r
  WHERE r.supplier_id = s.id AND r.is_active
  ORDER BY r.created_at DESC LIMIT 1
) ar ON true
CROSS JOIN LATERAL (
  SELECT CASE
           WHEN c.code = 'ENERG_GAS' AND a.outlet_contatore IS NOT NULL THEN a.outlet_contatore
           WHEN c.code = 'VIAGGI' AND a.outlet_luogo IS NOT NULL THEN a.outlet_luogo
           ELSE a.outlet_nominato END AS outlet_id,
         CASE
           WHEN c.code = 'ENERG_GAS' AND a.outlet_contatore IS NOT NULL THEN 'contatore'
           WHEN c.code = 'VIAGGI' AND a.outlet_luogo IS NOT NULL THEN 'luogo'
           ELSE 'nominato' END AS fonte
) x
WHERE x.outlet_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.invoice_cost_overrides o2 WHERE o2.invoice_id = a.invoice_id)
  AND coalesce(nullif(s.cost_center, ''), 'all') = 'all'
  AND (ar.description IS NULL OR (ar.created_by IS NULL AND ar.description LIKE 'Automatica:%'))
  AND coalesce(ar.description, '') NOT LIKE 'Automatica: merce%'
  AND coalesce(ar.description, '') NOT LIKE 'Automatica: mezzi%'
  AND coalesce(c.code, '') NOT IN ('ACQ_MERCE', 'ACCESSORI_ABB_TO', 'MEZZI_E_CARBURANTE');

COMMENT ON VIEW public.v_negozio_fattura IS
  'Negozio di una singola fattura passiva: classificazione a mano (invoice_cost_overrides), altrimenti outlet letto dal documento (invoice_outlet_auto) per i fornitori a riparto automatico, merce e carburante esclusi. Senza riga vale il riparto del fornitore. Usata da v_costi_outlet_da_fatture e dalla colonna Negozio della Prima Nota. Migrazione 306.';

-- ── 5. Costi per outlet: la fattura prima del fornitore ───────────────────
CREATE OR REPLACE VIEW public.v_costi_outlet_da_fatture WITH (security_invoker = on) AS
WITH inv AS MATERIALIZED (
  SELECT DISTINCT ON (e.id) e.id AS invoice_id, e.company_id, e.invoice_date, p.supplier_id,
         CASE WHEN e.tipo_documento = 'TD04' THEN -abs(coalesce(e.net_amount, 0)) ELSE coalesce(e.net_amount, 0) END AS netto,
         nf.outlet_id AS ov_outlet, ov.gruppo AS ov_gruppo
  FROM public.electronic_invoices e
  LEFT JOIN public.payables p ON p.electronic_invoice_id = e.id
  LEFT JOIN public.invoice_cost_overrides ov ON ov.invoice_id = e.id
  LEFT JOIN public.v_negozio_fattura nf ON nf.invoice_id = e.id
  WHERE coalesce(e.tipo_documento, 'TD01') NOT IN ('TD16', 'TD17', 'TD18')
    AND NOT EXISTS (SELECT 1 FROM public.invoice_cost_flags f WHERE f.invoice_id = e.id)
  ORDER BY e.id, p.supplier_id NULLS LAST
),
quote AS MATERIALIZED (
  SELECT s.id AS supplier_id, o.id AS outlet_id, 100::numeric AS pct
  FROM public.suppliers s
  JOIN public.outlets o ON o.company_id = s.company_id AND o.cost_center_key = s.cost_center
  WHERE coalesce(nullif(s.cost_center, ''), 'all') <> 'all'
  UNION ALL
  SELECT r.supplier_id, d.outlet_id, d.percentage
  FROM public.supplier_allocation_rules r
  JOIN public.supplier_allocation_details d ON d.rule_id = r.id
  JOIN public.suppliers s ON s.id = r.supplier_id
  WHERE r.is_active AND coalesce(nullif(s.cost_center, ''), 'all') = 'all'
),
ol AS MATERIALIZED (
  SELECT o.id, o.company_id, o.name, o.cost_center_key FROM public.outlets o
),
cassa AS MATERIALIZED (
  SELECT d.outlet_id, d.closing_date, d.cash_expenses
  FROM public.outlet_daily_closings d
  WHERE coalesce(d.cash_expenses, 0) <> 0 AND coalesce(d.status, '') <> 'bozza'
),
banca AS MATERIALIZED (
  SELECT b.id, b.company_id, b.transaction_date, b.amount, upper(b.description) AS d
  FROM public.bank_transactions b
  WHERE b.amount < 0 AND b.description ~* 'A FAVORE NEXI PAYMENTS|AMERICAN EXPRESS PAYMENTS'
),
contratti AS MATERIALIZED (
  SELECT c.company_id, c.outlet_id,
         CASE WHEN length(trim(c.merchant_code)) >= 8 THEN upper(trim(c.merchant_code)) END AS mc,
         CASE WHEN length(trim(c.payment_contract)) >= 8 THEN upper(trim(c.payment_contract)) END AS pc
  FROM public.acquirer_contracts c
  WHERE c.outlet_id IS NOT NULL
)
SELECT i.company_id,
       coalesce(i.ov_outlet, q.outlet_id) AS outlet_id,
       o.name AS outlet,
       o.cost_center_key,
       EXTRACT(YEAR FROM i.invoice_date)::int AS anno,
       EXTRACT(MONTH FROM i.invoice_date)::int AS mese,
       CASE WHEN i.ov_gruppo IS NOT NULL THEN i.ov_gruppo
            WHEN i.supplier_id IS NULL THEN 'senza_fornitore'
            WHEN c.code = 'ALLESTIMENTI' THEN 'allestimenti'
            ELSE coalesce(c.macro_group::text, 'senza_categoria') END AS gruppo,
       round(sum(i.netto * CASE WHEN i.ov_outlet IS NOT NULL THEN 100 ELSE coalesce(q.pct, 100) END / 100), 2) AS importo,
       count(DISTINCT i.invoice_id) AS fatture
FROM inv i
LEFT JOIN public.suppliers s ON s.id = i.supplier_id
LEFT JOIN public.cost_categories c ON c.id = s.default_cost_category_id
LEFT JOIN quote q ON i.ov_outlet IS NULL AND q.supplier_id = i.supplier_id
LEFT JOIN ol o ON o.id = coalesce(i.ov_outlet, q.outlet_id)
WHERE i.invoice_date IS NOT NULL
GROUP BY 1, 2, 3, 4, 5, 6, 7
UNION ALL
SELECT g.company_id,
       g.outlet_id,
       o.name AS outlet,
       o.cost_center_key,
       g.year AS anno,
       g.month AS mese,
       x.gruppo,
       round(sum(x.importo), 2) AS importo,
       0::bigint AS fatture
FROM public.v_personnel_gross_cost g
CROSS JOIN LATERAL (VALUES ('personale'::text, g.costo_lordo_outlet),
                           ('amministratori'::text, g.amministratori_totale)) x(gruppo, importo)
LEFT JOIN ol o ON o.id = g.outlet_id
WHERE x.importo <> 0
GROUP BY 1, 2, 3, 4, 5, 6, 7
UNION ALL
SELECT o.company_id, o.id, o.name, o.cost_center_key,
       EXTRACT(YEAR FROM d.closing_date)::int, EXTRACT(MONTH FROM d.closing_date)::int,
       'spese_cassa'::text, round(sum(d.cash_expenses), 2), 0::bigint
FROM cassa d
JOIN ol o ON o.id = d.outlet_id
GROUP BY 1, 2, 3, 4, 5, 6, 7
UNION ALL
SELECT x.company_id, x.outlet_id, o.name, o.cost_center_key,
       EXTRACT(YEAR FROM x.transaction_date)::int, EXTRACT(MONTH FROM x.transaction_date)::int,
       'commissioni_incasso'::text, round(sum(-x.amount), 2), 0::bigint
FROM (
  SELECT b.id, b.company_id, b.transaction_date, b.amount, min(c.outlet_id::text)::uuid AS outlet_id
  FROM banca b
  JOIN contratti c ON c.company_id = b.company_id
   AND ((c.mc IS NOT NULL AND position(c.mc IN b.d) > 0) OR (c.pc IS NOT NULL AND position(c.pc IN b.d) > 0))
  GROUP BY b.id, b.company_id, b.transaction_date, b.amount
  HAVING count(DISTINCT c.outlet_id) = 1
) x
LEFT JOIN ol o ON o.id = x.outlet_id
GROUP BY 1, 2, 3, 4, 5, 6, 7;

COMMENT ON VIEW public.v_costi_outlet_da_fatture IS
  'Costi per outlet/mese/gruppo: fatture passive sul negozio della singola fattura (v_negozio_fattura: classificazione a mano, poi outlet letto dal documento), altrimenti ripartite con le regole dei fornitori; personale e amministratori da v_personnel_gross_cost, spese di cassa delle chiusure (spese_cassa), commissioni Amex e Nexi addebitate in banca (commissioni_incasso). Sola lettura. outlet_id NULL = non assegnato. Esclusi TD16/17/18 e invoice_cost_flags. Migrazioni 285, 290, 291, 293, 294, 297, 306.';

-- ── 6. Job: fatture nuove ogni notte, tutte la domenica ──────────────────
SELECT cron.schedule('negozio-per-fattura-notturno', '55 2 * * *',
  $cron$SET statement_timeout = '15min'; SELECT public.fn_negozio_per_fattura_tutte(false);$cron$);
SELECT cron.schedule('negozio-per-fattura-settimanale', '15 3 * * 0',
  $cron$SET statement_timeout = '30min'; SELECT public.fn_negozio_per_fattura_tutte(true);$cron$);
