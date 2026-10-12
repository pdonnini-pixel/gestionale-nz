-- Migrazione 285 — allestimenti, caparre e costi per outlet da fatture (12/10/2026)
--
-- Deciso da Patrizio il 12/10/2026, dopo la verifica di Torino e Roma Soratte:
-- 1. Categoria ALLESTIMENTI («Allestimenti e aperture»): arredi, insegne,
--    impianti, progettazione e lavori per aprire un negozio. Sono investimenti
--    di avvio, non costi correnti: il riparto non li divide mai sugli outlet
--    (restano all'outlet nominato in fattura) e la vista li tiene a parte.
-- 2. invoice_cost_flags: fatture che non sono costi (caparre confirmatorie,
--    depositi a garanzia, e le note di credito che le stornano). Si
--    riconoscono dalle righe; «deposito cauzionale» NO, perché sta dentro le
--    bollette insieme ai consumi veri (Publiacqua). Riempita qui e ogni notte.
-- 3. v_costi_outlet_da_fatture (sola lettura, security_invoker): costi da
--    fatture passive per outlet, mese e gruppo, ripartiti con le regole dei
--    fornitori. Note di credito in negativo; esclusi autofatture di
--    integrazione IVA (TD16/17/18) e fatture segnate al punto 2. Non scrive
--    niente e non tocca budget_entries né budget_confronto.
-- Vale su ogni tenant. Solo aggiunte.

-- 1. Categoria
INSERT INTO public.cost_categories (company_id, code, name, macro_group, is_active, notes)
SELECT c.id, 'ALLESTIMENTI', 'Allestimenti e aperture', 'generali_amministrative', true,
       'Arredi, insegne, impianti, progettazione e lavori di apertura di un negozio. Investimento di avvio, tenuto a parte nei costi per outlet (migrazione 285).'
FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.cost_categories x WHERE x.company_id = c.id AND x.code = 'ALLESTIMENTI');

-- 2. Fatture che non sono costi
CREATE TABLE IF NOT EXISTS public.invoice_cost_flags (
  invoice_id  uuid PRIMARY KEY REFERENCES public.electronic_invoices(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('caparra_deposito')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.invoice_cost_flags IS
  'Fatture passive che non sono costi (caparre, depositi a garanzia e loro storni). Escluse da v_costi_outlet_da_fatture. Riempita da fn_segna_fatture_non_costo.';
ALTER TABLE public.invoice_cost_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON public.invoice_cost_flags FOR ALL
  USING (company_id IN (SELECT user_profiles.company_id FROM public.user_profiles WHERE user_profiles.id = auth.uid()));
CREATE POLICY viewer_no_insert ON public.invoice_cost_flags FOR INSERT
  WITH CHECK (COALESCE((public.get_my_role())::text, '') <> 'viewer');
CREATE POLICY viewer_no_update ON public.invoice_cost_flags FOR UPDATE
  USING (COALESCE((public.get_my_role())::text, '') <> 'viewer')
  WITH CHECK (COALESCE((public.get_my_role())::text, '') <> 'viewer');
CREATE POLICY viewer_no_delete ON public.invoice_cost_flags FOR DELETE
  USING (COALESCE((public.get_my_role())::text, '') <> 'viewer');

CREATE OR REPLACE FUNCTION public.fn_segna_fatture_non_costo(p_company_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO public.invoice_cost_flags (invoice_id, company_id, kind, note)
  SELECT e.id, e.company_id, 'caparra_deposito', 'righe: caparra / deposito a garanzia'
  FROM public.electronic_invoices e
  WHERE e.company_id = p_company_id
    AND e.invoice_date >= ((now() AT TIME ZONE 'Europe/Rome')::date - interval '24 months')
    AND NOT EXISTS (SELECT 1 FROM public.invoice_cost_flags f WHERE f.invoice_id = e.id)
    AND public.fn_testo_fattura_ricercabile(e.xml_content) ~ '(caparra|deposito (a |di |in )?garanzia)'
  ON CONFLICT (invoice_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_segna_fatture_non_costo(uuid) FROM PUBLIC, anon, authenticated;

SELECT public.fn_segna_fatture_non_costo(c.id) FROM public.companies c;

-- Il giro notturno segna anche le fatture nuove
CREATE OR REPLACE FUNCTION public.fn_riparto_automatico_tutte()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c uuid;
  out jsonb := '[]'::jsonb;
BEGIN
  FOR c IN SELECT DISTINCT company_id FROM public.suppliers WHERE company_id IS NOT NULL LOOP
    PERFORM public.fn_segna_fatture_non_costo(c);
    out := out || jsonb_build_array(public.fn_riparto_automatico(c));
  END LOOP;
  RETURN out;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_riparto_automatico_tutte() FROM PUBLIC, anon, authenticated;

-- 3. Vista: costi da fatture per outlet
CREATE OR REPLACE VIEW public.v_costi_outlet_da_fatture WITH (security_invoker = on) AS
WITH inv AS (
  SELECT DISTINCT ON (e.id) e.id AS invoice_id, e.company_id, e.invoice_date, p.supplier_id,
         CASE WHEN e.tipo_documento = 'TD04' THEN -abs(coalesce(e.net_amount, 0)) ELSE coalesce(e.net_amount, 0) END AS netto
  FROM public.electronic_invoices e
  LEFT JOIN public.payables p ON p.electronic_invoice_id = e.id
  WHERE coalesce(e.tipo_documento, 'TD01') NOT IN ('TD16', 'TD17', 'TD18')
    AND NOT EXISTS (SELECT 1 FROM public.invoice_cost_flags f WHERE f.invoice_id = e.id)
  ORDER BY e.id, p.supplier_id NULLS LAST
),
quote AS (
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
)
SELECT i.company_id,
       q.outlet_id,
       o.name AS outlet,
       o.cost_center_key,
       EXTRACT(YEAR FROM i.invoice_date)::int AS anno,
       EXTRACT(MONTH FROM i.invoice_date)::int AS mese,
       CASE WHEN i.supplier_id IS NULL THEN 'senza_fornitore'
            WHEN c.code = 'ALLESTIMENTI' THEN 'allestimenti'
            ELSE coalesce(c.macro_group::text, 'senza_categoria') END AS gruppo,
       round(sum(i.netto * coalesce(q.pct, 100) / 100), 2) AS importo,
       count(DISTINCT i.invoice_id) AS fatture
FROM inv i
LEFT JOIN public.suppliers s ON s.id = i.supplier_id
LEFT JOIN public.cost_categories c ON c.id = s.default_cost_category_id
LEFT JOIN quote q ON q.supplier_id = i.supplier_id
LEFT JOIN public.outlets o ON o.id = q.outlet_id
WHERE i.invoice_date IS NOT NULL
GROUP BY 1, 2, 3, 4, 5, 6, 7;

COMMENT ON VIEW public.v_costi_outlet_da_fatture IS
  'Costi da fatture passive per outlet/mese/gruppo, ripartiti con le regole dei fornitori. Sola lettura. outlet_id NULL = non assegnato. Esclusi TD16/17/18 e invoice_cost_flags. Migrazione 285.';

-- 4. Riparto: gli allestimenti non si ripartiscono come struttura
CREATE OR REPLACE FUNCTION public.fn_riparto_automatico(p_company_id uuid, p_prova boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_year   int := EXTRACT(YEAR FROM (now() AT TIME ZONE 'Europe/Rome'))::int;
  v_from   date := ((now() AT TIME ZONE 'Europe/Rome')::date - interval '12 months')::date;
  v_hq     uuid;
  s        record;
  v_mode   text;
  v_motivo text;
  v_want   jsonb;     -- {outlet_id: pct}
  v_have   jsonb;
  v_rule   record;
  v_new    uuid;
  v_created int := 0;
  v_replaced int := 0;
  v_same   int := 0;
  v_merce  boolean;
  v_acquisti boolean;  -- merce, o costo che si ripartisce come la merce
  v_piano  jsonb := '[]'::jsonb;  -- cosa è stato (o sarebbe, in prova) creato o sostituito
BEGIN
  -- Sede: l'outlet legato al centro di costo con ruolo 'hq'
  SELECT o.id INTO v_hq
  FROM public.cost_centers cc
  JOIN public.outlets o ON o.company_id = cc.company_id AND o.cost_center_key = cc.code AND o.is_active
  WHERE cc.company_id = p_company_id AND cc.role = 'hq'
  ORDER BY o.created_at LIMIT 1;

  -- Parole che identificano ogni outlet: nome, città, centro commerciale
  FOR s IN
    SELECT sp.id, sp.name, sp.citta, sp.comune, sp.provincia,
           cat.code AS cat_code, cat.macro_group::text AS cat_group,
           ar.id AS rule_id, ar.description AS rule_desc
    FROM public.suppliers sp
    LEFT JOIN public.cost_categories cat ON cat.id = sp.default_cost_category_id
    LEFT JOIN LATERAL (
      SELECT r.id, r.description, r.created_by FROM public.supplier_allocation_rules r
      WHERE r.supplier_id = sp.id AND r.is_active ORDER BY r.created_at DESC LIMIT 1
    ) ar ON true
    WHERE sp.company_id = p_company_id
      AND coalesce(nullif(sp.cost_center, ''), 'all') = 'all'
      AND (ar.id IS NULL OR (ar.created_by IS NULL AND ar.description LIKE 'Automatica:%'))
  LOOP
    v_want := NULL; v_mode := NULL; v_motivo := NULL;
    -- La merce arriva al magazzino: le sue fatture nominano il luogo di
    -- consegna, non l'outlet che la vende. Per la merce vale solo il preventivo.
    v_merce := coalesce(s.cat_code, '') IN ('ACQ_MERCE', 'ACCESSORI_ABB_TO')
               OR coalesce(s.rule_desc, '') LIKE 'Automatica: merce%';
    -- Mezzi e carburante: come la merce, in proporzione al preventivo acquisti
    -- (deciso da Patrizio il 12/10/2026, migrazione 281)
    v_acquisti := v_merce OR coalesce(s.cat_code, '') = 'MEZZI_E_CARBURANTE';

    -- 1. Energia: codici POD/PDR → outlet
    IF s.cat_code = 'ENERG_GAS' THEN
      WITH inv AS (
        SELECT DISTINCT ON (e.id) e.id AS inv_id, abs(coalesce(e.net_amount, 0)) AS net,
               public.fn_testo_fattura_ricercabile(e.xml_content) AS txt
        FROM public.payables p
        JOIN public.electronic_invoices e ON e.id = p.electronic_invoice_id
        WHERE p.supplier_id = s.id AND e.company_id = p_company_id
          AND e.invoice_date >= v_from AND coalesce(e.xml_content, '') <> ''
      ),
      per_inv AS (
        SELECT i.inv_id, i.net,
               array(SELECT DISTINCT m[1] FROM regexp_matches(upper(i.txt),
                     '(IT[0-9]{3}E[0-9A-Z]{8,9}|(?<![0-9])[0-9]{14}(?![0-9]))', 'g') m) AS codes
        FROM inv i
      ),
      chk AS (
        SELECT pi.*, cardinality(pi.codes) > 0
                 AND NOT EXISTS (SELECT 1 FROM unnest(pi.codes) cd
                                  WHERE NOT EXISTS (SELECT 1 FROM public.utility_supply_points usp
                                                     WHERE usp.company_id = p_company_id AND usp.code = cd)) AS ok
        FROM per_inv pi
      ),
      w AS (
        SELECT usp.outlet_id, sum(c.net / cardinality(c.codes)) AS a
        FROM chk c
        JOIN public.utility_supply_points usp ON usp.company_id = p_company_id AND usp.code = ANY (c.codes)
        GROUP BY usp.outlet_id
      )
      SELECT CASE WHEN (SELECT count(*) FROM chk) > 0 AND (SELECT bool_and(ok) FROM chk)
                  THEN (SELECT jsonb_object_agg(outlet_id, a) FROM w WHERE a > 0) END
        INTO v_want;
      IF v_want IS NOT NULL THEN
        v_motivo := 'bollette ripartite per punto di fornitura (POD/PDR)';
      END IF;
    END IF;

    -- 1b. Trasferte e pasti (categoria VIAGGI): il costo va all'outlet del
    --     luogo in cui si mangia, si dorme o si arriva. Il luogo si legge dalle
    --     righe della fattura (es. «Firenze S.M.N. - Brescia»); poi dall'email
    --     del cedente (le catene fatturano dalla sede legale ma scrivono il
    --     locale: «valdichiana@oldwildwest.it»); poi dalla città e provincia
    --     del fornitore (ristorante, albergo).
    --     I luoghi di ogni outlet stanno in outlet_travel_places: «comune» si
    --     cerca nelle righe e nella città del fornitore, «provincia» si
    --     confronta con la provincia del fornitore. Una fattura con più outlet
    --     si divide in parti uguali; una senza luogo riconosciuto va alla sede.
    IF v_want IS NULL AND s.cat_code = 'VIAGGI'
       AND EXISTS (SELECT 1 FROM public.outlet_travel_places tp WHERE tp.company_id = p_company_id) THEN
      WITH inv AS (
        SELECT DISTINCT ON (e.id) e.id AS inv_id, abs(coalesce(e.net_amount, 0)) AS net,
               public.fn_testo_fattura_ricercabile(e.xml_content) AS txt,
               lower(coalesce(
                 substring(e.xml_content from '<CedentePrestatore>.*?<Email>([^<]+)</Email>.*?</CedentePrestatore>'),
                 substring(e.xml_content from '"cedente_prestatore": \{.*?"email": "([^"]*)"'), '')) AS email
        FROM public.payables p
        JOIN public.electronic_invoices e ON e.id = p.electronic_invoice_id
        WHERE p.supplier_id = s.id AND e.company_id = p_company_id
          AND e.invoice_date >= v_from AND coalesce(e.xml_content, '') <> ''
      ),
      tp AS (
        SELECT t.outlet_id, t.kind, lower(t.place) AS place
        FROM public.outlet_travel_places t
        JOIN public.outlets o ON o.id = t.outlet_id AND o.is_active
        WHERE t.company_id = p_company_id
      ),
      h AS (
        SELECT i.inv_id, i.net,
               coalesce(
                 nullif(array(SELECT DISTINCT tp.outlet_id FROM tp
                               WHERE tp.kind = 'comune' AND i.txt ~ ('\m' || tp.place || '\M')), '{}'),
                 nullif(array(SELECT DISTINCT tp.outlet_id FROM tp
                               WHERE tp.kind = 'comune' AND i.email ~ ('\m' || tp.place || '\M')), '{}'),
                 array(SELECT DISTINCT tp.outlet_id FROM tp
                        WHERE (tp.kind = 'comune' AND lower(concat_ws(' ', s.citta, s.comune)) ~ ('\m' || tp.place || '\M'))
                           OR (tp.kind = 'provincia' AND upper(trim(coalesce(s.provincia, ''))) = upper(tp.place)))) AS outs
        FROM inv i
      ),
      w AS (
        SELECT x.o, sum(x.a) AS a FROM (
          SELECT unnest(outs) AS o, net / cardinality(outs) AS a FROM h WHERE cardinality(outs) > 0
          UNION ALL
          SELECT v_hq, net FROM h WHERE cardinality(outs) = 0 AND v_hq IS NOT NULL
        ) x GROUP BY x.o
      )
      SELECT CASE WHEN (SELECT count(*) FROM h WHERE cardinality(outs) > 0) > 0
                  THEN (SELECT jsonb_object_agg(o, a) FROM w WHERE a > 0) END,
             format('trasferte e pasti, outlet del luogo (%s fatture su %s)',
                    (SELECT count(*) FROM h WHERE cardinality(outs) > 0), (SELECT count(*) FROM h))
        INTO v_want, v_motivo;
      IF v_want IS NULL THEN
        v_motivo := NULL;
      END IF;
    END IF;

    -- 2. Outlet nominato in ogni fattura
    IF v_want IS NULL AND NOT v_acquisti THEN
      WITH inv AS (
        SELECT DISTINCT ON (e.id) e.id AS inv_id, abs(coalesce(e.net_amount, 0)) AS net,
               public.fn_testo_fattura_ricercabile(e.xml_content) AS txt
        FROM public.payables p
        JOIN public.electronic_invoices e ON e.id = p.electronic_invoice_id
        WHERE p.supplier_id = s.id AND e.company_id = p_company_id
          AND e.invoice_date >= v_from AND coalesce(e.xml_content, '') <> ''
      ),
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
      h AS (
        SELECT i.inv_id, i.net, array_agg(k.outlet_id) FILTER (WHERE k.outlet_id IS NOT NULL) AS outs
        FROM inv i
        LEFT JOIN kw k ON k.kw IS NOT NULL AND i.txt ~ ('\m(' || k.kw || ')\M')
        GROUP BY i.inv_id, i.net
      )
      -- Nessuna fattura nomina due outlet e almeno l'80% ne nomina uno solo:
      -- le quote si calcolano sulle fatture che lo nominano.
      SELECT CASE WHEN count(*) > 0
                   AND bool_and(coalesce(cardinality(outs), 0) <= 1)
                   AND count(*) FILTER (WHERE cardinality(outs) = 1) >= 0.8 * count(*) THEN
               (SELECT jsonb_object_agg(o, a) FROM (SELECT outs[1] AS o, sum(net) AS a FROM h
                                                     WHERE cardinality(outs) = 1 GROUP BY outs[1]) z WHERE a > 0)
             END,
             format('le fatture nominano l''outlet (%s su %s)', count(*) FILTER (WHERE cardinality(outs) = 1), count(*))
        INTO v_want, v_motivo
      FROM h;
      IF v_want IS NULL THEN
        v_motivo := NULL;
      END IF;
    END IF;

    -- 2b. Il nome stesso del fornitore contiene un solo outlet: nome o centro
    --     commerciale dell'outlet; la città conta solo per i Comuni
    --     (es. «Comune di Sant'Oreste» → Roma Soratte, «Tari Valdichiana»)
    IF v_want IS NULL AND NOT v_acquisti THEN
      SELECT CASE WHEN count(*) = 1 THEN jsonb_build_object(min(k.outlet_id::text), 1) END
        INTO v_want
      FROM (
        SELECT o.id AS outlet_id,
          (SELECT string_agg(DISTINCT w, '|')
             FROM unnest(regexp_split_to_array(lower(concat_ws(' ', o.name, o.mall_name,
                    CASE WHEN lower(s.name) LIKE 'comune di%' THEN o.city END)), '[^a-zà-ù]+')) w
            WHERE length(w) >= 5
              AND w NOT IN ('outlet','village','fashion','store','magazzino','ufficio','negozio','punto','vendita',
                            'centro','commerciale','shopping','designer','luxury','sede','della','delle')) AS kw
        FROM public.outlets o
        WHERE o.company_id = p_company_id AND o.is_active
      ) k
      WHERE k.kw IS NOT NULL AND lower(s.name) ~ ('\m(' || k.kw || ')\M');
      IF v_want IS NOT NULL THEN
        v_motivo := 'il nome del fornitore indica l''outlet';
      END IF;
    END IF;

    -- 3. Merce (e mezzi e carburante): quote del preventivo acquisti dell'anno
    IF v_want IS NULL AND v_acquisti THEN
      SELECT jsonb_object_agg(outlet_id, a) INTO v_want
      FROM (
        SELECT o.id AS outlet_id, sum(be.budget_amount) AS a
        FROM public.budget_entries be
        JOIN public.chart_of_accounts c ON c.code = be.account_code AND c.company_id = be.company_id
        JOIN public.outlets o ON o.company_id = be.company_id AND o.cost_center_key = be.cost_center AND o.is_active
        WHERE be.company_id = p_company_id AND be.year = v_year
          AND be.is_placeholder IS NOT TRUE
          AND c.macro_group = 'costi_produzione'
          AND be.cost_center NOT IN ('all', 'rettifica_bilancio')
        GROUP BY o.id
        HAVING sum(be.budget_amount) > 0
      ) z;
      IF v_want IS NOT NULL THEN
        v_motivo := format(CASE WHEN v_merce THEN 'merce ripartita come il preventivo acquisti %s'
                                ELSE 'mezzi e carburante ripartiti come il preventivo acquisti %s' END, v_year);
      END IF;
    END IF;

    -- 4. Struttura (allestimenti esclusi: vanno all'outlet che si apre, mai
    --    ripartiti; senza outlet ricavabile restano senza regola), sugli outlet in proporzione ai ricavi dell'anno (deciso da
    --    Patrizio il 12/10/2026, migrazione 284). Ricavi = consuntivo dei mesi
    --    che lo hanno, preventivo per gli altri (stessa regola di Budget &
    --    Controllo), solo centri con ruolo 'outlet'. Vale per le categorie di
    --    struttura e per i fornitori senza categoria già messi qui dal sistema
    --    («Automatica: costo di struttura…», migrazione 277).
    --    Le trasferte senza località restano alla sede: sono viaggi e pasti
    --    intorno alla sede. Senza ricavi (tenant nuovo) si ricade sulla sede.
    IF v_want IS NULL AND v_hq IS NOT NULL
       AND ((s.cat_group IN ('generali_amministrative', 'finanziarie', 'oneri_diversi')
             AND coalesce(s.cat_code, '') NOT IN ('ENERG_GAS', 'ALLESTIMENTI'))
            OR (s.cat_code IS NULL AND coalesce(s.rule_desc, '') LIKE 'Automatica: costo di struttura%')) THEN
      IF coalesce(s.cat_code, '') <> 'VIAGGI' THEN
        WITH m AS (
          SELECT bc.cost_center, bc.month,
                 sum(bc.amount) FILTER (WHERE bc.entry_type = 'cons_monthly') AS cons,
                 sum(bc.amount) FILTER (WHERE bc.entry_type = 'rev_monthly') AS prev
          FROM public.budget_confronto bc
          WHERE bc.company_id = p_company_id AND bc.year = v_year
            AND bc.entry_type IN ('cons_monthly', 'rev_monthly')
          GROUP BY bc.cost_center, bc.month
        ),
        z AS (SELECT cost_center, sum(coalesce(cons, prev)) AS a FROM m GROUP BY cost_center)
        SELECT jsonb_object_agg(o.id, z.a) INTO v_want
        FROM z
        JOIN public.outlets o ON o.company_id = p_company_id AND o.cost_center_key = z.cost_center AND o.is_active
        JOIN public.cost_centers cc ON cc.company_id = o.company_id AND cc.code = o.cost_center_key AND cc.role = 'outlet'
        WHERE z.a > 0;
        IF v_want IS NOT NULL THEN
          v_motivo := format('costo di struttura, sugli outlet in proporzione ai ricavi %s', v_year);
        END IF;
      END IF;
      IF v_want IS NULL THEN
        v_want := jsonb_build_object(v_hq, 1);
        v_motivo := CASE WHEN s.cat_code = 'VIAGGI' THEN 'trasferte senza località, alla sede'
                         ELSE 'costo di struttura, alla sede' END;
      END IF;
    END IF;

    CONTINUE WHEN v_want IS NULL;

    -- Pesi → percentuali a due decimali che sommano esattamente 100
    WITH w AS (SELECT key::uuid AS outlet_id, value::numeric AS a FROM jsonb_each_text(v_want)),
    q AS (SELECT outlet_id, a, round(100 * a / sum(a) OVER (), 2) AS pct,
                 row_number() OVER (ORDER BY a DESC, outlet_id) AS rn FROM w),
    f AS (SELECT outlet_id, CASE WHEN rn = 1 THEN pct + (100 - sum(pct) OVER ()) ELSE pct END AS p FROM q)
    SELECT jsonb_object_agg(outlet_id, p) INTO v_want FROM f;
    v_mode := CASE WHEN (SELECT count(*) FROM jsonb_object_keys(v_want)) = 1 THEN 'DIRETTO' ELSE 'SPLIT_PCT' END;

    -- Regola attuale (se automatica): uguale? allora niente
    IF s.rule_id IS NOT NULL THEN
      SELECT jsonb_object_agg(d.outlet_id, d.percentage) INTO v_have
      FROM public.supplier_allocation_details d WHERE d.rule_id = s.rule_id;
      IF v_have IS NOT NULL
         AND (SELECT bool_and(abs((v_have->>k)::numeric - (v_want->>k)::numeric) < 0.01)
                FROM jsonb_object_keys(v_want) k)
         AND (SELECT count(*) FROM jsonb_object_keys(v_have)) = (SELECT count(*) FROM jsonb_object_keys(v_want)) THEN
        v_same := v_same + 1;
        CONTINUE;
      END IF;
      v_replaced := v_replaced + 1;
    ELSE
      v_created := v_created + 1;
    END IF;

    v_piano := v_piano || jsonb_build_array(jsonb_build_object(
      'fornitore', s.name, 'modo', v_mode, 'motivo', v_motivo,
      'sostituisce', s.rule_id IS NOT NULL,
      'quote', (SELECT jsonb_object_agg(o.name, (v_want->>o.id::text)::numeric)
                  FROM public.outlets o WHERE v_want ? o.id::text)));
    CONTINUE WHEN p_prova;

    IF s.rule_id IS NOT NULL THEN
      UPDATE public.supplier_allocation_rules SET is_active = false, updated_at = now() WHERE id = s.rule_id;
    END IF;

    INSERT INTO public.supplier_allocation_rules (company_id, supplier_id, allocation_mode, description, is_active)
    VALUES (p_company_id, s.id, v_mode,
            format('Automatica: %s (aggiornata il %s)', v_motivo, to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY')),
            true)
    RETURNING id INTO v_new;
    INSERT INTO public.supplier_allocation_details (rule_id, outlet_id, percentage)
    SELECT v_new, key::uuid, value::numeric FROM jsonb_each_text(v_want);
  END LOOP;

  RETURN jsonb_build_object('company_id', p_company_id, 'prova', p_prova, 'create', v_created,
                            'sostituite', v_replaced, 'invariate', v_same, 'eseguito_il', now(),
                            'piano', v_piano);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_riparto_automatico(uuid, boolean) FROM PUBLIC, anon, authenticated;
