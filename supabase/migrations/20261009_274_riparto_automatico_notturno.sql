-- Migrazione 274 — riparto automatico dei fornitori sugli outlet, ogni notte
--
-- Deciso da Patrizio il 09/10/2026: il riparto dei costi sugli outlet non deve
-- dipendere da qualcuno che lo imposta a mano fornitore per fornitore. Ogni
-- notte (migrazione 278) il sistema guarda i fornitori senza regola (o con una regola che ha
-- scritto lui) e applica, in quest'ordine, la prima regola che trova:
--
--   1. ENERGIA (categoria ENERG_GAS): ogni bolletta riporta POD/PDR; il punto
--      di fornitura → outlet sta in utility_supply_points (letto dalle bollette).
--      Se TUTTE le bollette degli ultimi 12 mesi hanno codici noti, la regola
--      ripartisce in proporzione agli importi per outlet.
--   2. OUTLET NOMINATO NELLA FATTURA (qualsiasi categoria): se ogni fattura
--      degli ultimi 12 mesi nomina uno e un solo outlet (nome, città o centro
--      commerciale dell'outlet), la regola ripartisce in proporzione agli
--      importi per outlet (DIRETTO se è sempre lo stesso). I dati del cedente
--      e del cessionario e gli allegati sono esclusi dalla ricerca.
--   3. MERCE (categorie ACQ_MERCE, ACCESSORI_ABB_TO, o regola automatica
--      «merce» già assegnata): quote del preventivo acquisti dell'anno per
--      outlet (come la 273), Roma Soratte e gli outlet in apertura compresi.
--   4. STRUTTURA (categorie dei gruppi generali_amministrative, finanziarie,
--      oneri_diversi, energia esclusa): tutto alla sede (centro con ruolo 'hq').
--   Locazioni senza outlet ricavabile e fornitori senza categoria restano
--   senza regola: serve una decisione, non un ripiego.
--
-- Regole del sistema: description «Automatica: …», created_by NULL.
-- Una regola messa a mano (created_by valorizzato o description diversa)
-- NON viene mai toccata. Una regola automatica viene sostituita solo se il
-- riparto calcolato cambia: la vecchia si disattiva (is_active=false), non si
-- cancella. Un fornitore con un centro di costo specifico non viene toccato.
-- Nessun nome, id o P.IVA scritto a mano: vale su ogni tenant.

-- ── 1. Punti di fornitura energia / gas ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.utility_supply_points (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code        text NOT NULL,                 -- POD (IT001E…) o PDR (14 cifre)
  outlet_id   uuid NOT NULL REFERENCES public.outlets(id),
  address     text,                          -- indirizzo di fornitura letto dalla bolletta
  source      text,                          -- da dove viene il legame (bolletta, fattura, decisione)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
COMMENT ON TABLE public.utility_supply_points IS
  'Punto di fornitura (POD/PDR) → outlet, letto dalle bollette. Usato dal riparto automatico (fn_riparto_automatico).';

ALTER TABLE public.utility_supply_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON public.utility_supply_points FOR ALL
  USING (company_id IN (SELECT user_profiles.company_id FROM public.user_profiles WHERE user_profiles.id = auth.uid()));
CREATE POLICY viewer_no_insert ON public.utility_supply_points FOR INSERT
  WITH CHECK (COALESCE((public.get_my_role())::text, '') <> 'viewer');
CREATE POLICY viewer_no_update ON public.utility_supply_points FOR UPDATE
  USING (COALESCE((public.get_my_role())::text, '') <> 'viewer')
  WITH CHECK (COALESCE((public.get_my_role())::text, '') <> 'viewer');
CREATE POLICY viewer_no_delete ON public.utility_supply_points FOR DELETE
  USING (COALESCE((public.get_my_role())::text, '') <> 'viewer');

-- ── 2. Testo ricercabile di una fattura (senza parti e senza allegati) ─────
CREATE OR REPLACE FUNCTION public.fn_testo_fattura_ricercabile(p_doc text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  j jsonb;
BEGIN
  IF p_doc IS NULL OR p_doc = '' THEN RETURN ''; END IF;
  IF left(ltrim(p_doc), 1) = '{' THEN
    BEGIN
      j := p_doc::jsonb;
    EXCEPTION WHEN others THEN
      RETURN lower(p_doc);
    END;
    j := j #- '{fattura_elettronica_header,cedente_prestatore}'
           #- '{fattura_elettronica_header,cessionario_committente}';
    IF jsonb_typeof(j->'fattura_elettronica_body') = 'array' THEN
      SELECT jsonb_set(j, '{fattura_elettronica_body}',
               coalesce(jsonb_agg(b - 'allegati'), '[]'::jsonb))
        INTO j
        FROM jsonb_array_elements(j->'fattura_elettronica_body') b;
    END IF;
    RETURN lower(j::text);
  END IF;
  RETURN lower(regexp_replace(regexp_replace(regexp_replace(p_doc,
           '<CedentePrestatore>.*?</CedentePrestatore>', '', 'g'),
           '<CessionarioCommittente>.*?</CessionarioCommittente>', '', 'g'),
           '<Allegati>.*?</Allegati>', '', 'g'));
END;
$$;

-- ── 3. Riparto automatico di un'azienda ────────────────────────────────────
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
    SELECT sp.id, sp.name, cat.code AS cat_code, cat.macro_group::text AS cat_group,
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

    -- 2. Outlet nominato in ogni fattura
    IF v_want IS NULL AND NOT v_merce THEN
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
    IF v_want IS NULL AND NOT v_merce THEN
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

    -- 3. Merce: quote del preventivo acquisti dell'anno
    IF v_want IS NULL AND v_merce THEN
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
        v_motivo := format('merce ripartita come il preventivo acquisti %s', v_year);
      END IF;
    END IF;

    -- 4. Struttura: alla sede
    IF v_want IS NULL AND v_hq IS NOT NULL
       AND s.cat_group IN ('generali_amministrative', 'finanziarie', 'oneri_diversi')
       AND coalesce(s.cat_code, '') <> 'ENERG_GAS' THEN
      v_want := jsonb_build_object(v_hq, 1);
      v_motivo := 'costo di struttura, alla sede';
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

-- ── 4. Tutte le aziende del tenant ─────────────────────────────────────────
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
    out := out || jsonb_build_array(public.fn_riparto_automatico(c));
  END LOOP;
  RETURN out;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_riparto_automatico_tutte() FROM PUBLIC, anon, authenticated;

-- Il job notturno che chiama fn_riparto_automatico_tutte() è nella migrazione 278.
