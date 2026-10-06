-- =============================================================================
-- Paghe: gli stipendi pagati legati alle buste paga, gli F24 legati al Prospetto
-- Applicata su NZ + Made + Zago il 05/10/2026.
-- =============================================================================
--
-- PERCHE'. Ogni mese lo studio paghe manda l'Elenco netti e il Prospetto
-- riepilogativo. I netti finivano nelle buste paga, il Prospetto nel costo lordo
-- per outlet, e li' si fermavano. In banca, intanto:
--   * le disposizioni «DISPOSIZ.PER EMOLUMENTI» si chiudevano da sole come
--     «stipendi» (migration 186), senza dire QUALI buste pagavano;
--   * gli F24 del 16 si chiudevano come «tasse», senza confronto con quanto le
--     paghe dicevano di versare.
--
-- MISURATO su NZ (05/10/2026), settembre 2026:
--   9 disposizioni del 10-11/09 = 66.729,39; IMPORTO BONIFICI letto in causale
--   = 66.655,39 = Elenco netti di agosto al centesimo, filiale per filiale
--   (la sede in due disposizioni: 6.305,12 + 9.523,00 = 15.828,12).
--   Differenza 74,00 = commissioni, 1,75 a bonifico circa.
--   F24 del 16/09: 33.645,02 pagati; il Prospetto di agosto chiede 33.305,93
--   (INPS 23.739,31, EBINTER 85,40, Fondo EST 150,00, IRPEF 8.529,85,
--   addizionale regionale 573,76, comunale 227,61). Le deleghe portano anche
--   altro (ritenute, IVA): si guarda che coprano la quota paghe.
--
-- COLLAUDO su NZ in transazione annullata (05/10/2026), ultimi 6 mesi:
--   68 disposizioni, 268 buste agganciate in 0,3 secondi. Luglio 43 buste =
--   70.235,70 e agosto 42 buste = 66.655,39, tutte; la 14ª di giugno 37 buste
--   = 31.748,00 su 8 disposizioni. Restano fuori 4 disposizioni di maggio e
--   luglio (una persona pagata con piu' bonifici): troppo vecchie per una
--   domanda, restano non abbinate. Secondo giro: nessun effetto.
--   F24 di agosto: 4 deleghe il 16/09 per 66.911,64, nessuna combinazione fa
--   esattamente 33.305,93 → «pagato con altre voci».
--
-- COSA FA
--   1. payroll_payment_links: ogni busta paga (employee_cost_slips) pagata da una
--      disposizione emolumenti. Aggancio per importo esatto dei bonifici, dentro
--      la stessa filiale, mese prima o stesso mese del pagamento (stessa regola
--      del foglio di Prima nota, src/lib/primaNotaStipendi.ts).
--   2. payroll_f24_items: le righe del «RIEPILOGO IMPORTI A DEBITO/CREDITO» del
--      Prospetto (salvate dal frontend al caricamento). Ricaricare lo stesso mese
--      aggiunge una versione nuova: conta l'ultima, le altre restano.
--   3. payroll_f24_checks: per ogni periodo, F24 atteso, scadenza, deleghe
--      trovate in banca, esito.
--   4. fn_payroll_sync(company): fa 1 e 3, e chiede in chat (bank_document_questions,
--      R28) solo cio' che serve a un pagamento vero e che solo una persona sa.
--   5. payroll_sync_now() per l'utente, payroll_sync_all() per il cron giornaliero.
--
-- COSA NON FA. Non tocca bank_transactions, ne' le buste paga, ne' il costo
-- lordo: aggiunge solo righe nelle tabelle nuove. Si puo' annullare col rollback.
-- =============================================================================

BEGIN;

-- ── 1. buste paga ↔ disposizioni emolumenti ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  slip_id uuid NOT NULL REFERENCES public.employee_cost_slips(id) ON DELETE CASCADE,
  bank_transaction_id uuid NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL,
  tipo text,
  outlet_code text,
  netto numeric(14,2) NOT NULL,
  id_flusso text,
  importo_bonifici numeric(14,2),
  commissioni numeric(14,2),
  n_bonifici integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_payment_links_slip_uq UNIQUE (slip_id)
);
CREATE INDEX IF NOT EXISTS payroll_payment_links_bt_idx ON public.payroll_payment_links (bank_transaction_id);
CREATE INDEX IF NOT EXISTS payroll_payment_links_period_idx ON public.payroll_payment_links (company_id, year, month);
COMMENT ON TABLE public.payroll_payment_links IS
  'Busta paga (employee_cost_slips) pagata da una disposizione emolumenti in banca. Scritta solo da fn_payroll_sync (migration 268).';

-- ── 2. voci di versamento del Prospetto paghe ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_f24_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  import_id uuid REFERENCES public.personnel_gross_cost_imports(id) ON DELETE SET NULL,
  year integer NOT NULL,           -- mese del Prospetto (competenza)
  month integer NOT NULL,
  filiale_code text,
  codice text,
  descrizione text NOT NULL,
  canale text NOT NULL CHECK (canale IN ('f24', 'fondo')),
  periodo date NOT NULL,           -- primo giorno del «Periodo versamento»
  importo numeric(14,2) NOT NULL,
  -- Ogni caricamento del Prospetto e' una versione: le precedenti restano,
  -- conta l'ultima del mese (niente cancellazioni).
  batch_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payroll_f24_items_period_idx ON public.payroll_f24_items (company_id, year, month);
CREATE INDEX IF NOT EXISTS payroll_f24_items_batch_idx ON public.payroll_f24_items (company_id, year, month, created_at DESC);
CREATE INDEX IF NOT EXISTS payroll_f24_items_vers_idx ON public.payroll_f24_items (company_id, canale, periodo);
COMMENT ON TABLE public.payroll_f24_items IS
  'Righe del «RIEPILOGO IMPORTI A DEBITO/CREDITO» del Prospetto paghe: cosa versare, a chi, per quale periodo. Un caricamento = un batch_id; per ogni mese conta l''ultimo, i precedenti restano come storico (migration 268).';

-- ── 3. controllo F24 del personale per periodo ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_f24_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  periodo date NOT NULL,
  scadenza date NOT NULL,
  atteso numeric(14,2) NOT NULL,
  pagato numeric(14,2),
  bank_transaction_ids uuid[] NOT NULL DEFAULT '{}',
  esito text NOT NULL CHECK (esito IN ('in_attesa', 'pagato', 'pagato_con_altre_voci', 'da_chiarire')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_f24_checks_uq UNIQUE (company_id, periodo)
);
COMMENT ON TABLE public.payroll_f24_checks IS
  'F24 del personale atteso dal Prospetto paghe e deleghe trovate in banca intorno al 16 del mese dopo. Scritta solo da fn_payroll_sync (migration 268).';

ALTER TABLE public.payroll_payment_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_f24_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_f24_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_payment_links_select ON public.payroll_payment_links FOR SELECT USING (company_id = public.get_my_company_id());
CREATE POLICY payroll_f24_items_select ON public.payroll_f24_items FOR SELECT USING (company_id = public.get_my_company_id());
CREATE POLICY payroll_f24_checks_select ON public.payroll_f24_checks FOR SELECT USING (company_id = public.get_my_company_id());
REVOKE INSERT, UPDATE, DELETE ON public.payroll_payment_links, public.payroll_f24_items, public.payroll_f24_checks FROM anon, authenticated;
GRANT SELECT ON public.payroll_payment_links, public.payroll_f24_items, public.payroll_f24_checks TO authenticated;

-- ── 4a. sottoinsieme che fa esattamente la cifra ────────────────────────────
-- Prima il gruppo intero; poi, fino a 16 buste, il sottoinsieme piu' numeroso
-- che somma al centesimo. Se ce ne sono due diversi della stessa misura non si
-- sceglie: meglio nessun aggancio che quello sbagliato.
CREATE OR REPLACE FUNCTION public.fn_payroll_subset(p_ids uuid[], p_amts numeric[], p_target numeric)
RETURNS uuid[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n int := COALESCE(array_length(p_ids, 1), 0);
  v_mask int;
  v_sum numeric;
  v_cnt int;
  v_best int := 0;
  v_best_mask int := 0;
  v_ties int := 0;
  i int;
  v_out uuid[] := ARRAY[]::uuid[];
BEGIN
  IF n = 0 THEN RETURN NULL; END IF;
  SELECT sum(x) INTO v_sum FROM unnest(p_amts) x;
  IF round(v_sum, 2) = round(p_target, 2) THEN RETURN p_ids; END IF;
  IF n > 16 THEN RETURN NULL; END IF;
  FOR v_mask IN 1 .. (1 << n) - 2 LOOP
    v_sum := 0; v_cnt := 0;
    FOR i IN 1 .. n LOOP
      IF (v_mask & (1 << (i - 1))) <> 0 THEN v_sum := v_sum + p_amts[i]; v_cnt := v_cnt + 1; END IF;
    END LOOP;
    IF round(v_sum, 2) = round(p_target, 2) THEN
      IF v_cnt > v_best THEN v_best := v_cnt; v_best_mask := v_mask; v_ties := 1;
      ELSIF v_cnt = v_best THEN v_ties := v_ties + 1; END IF;
    END IF;
  END LOOP;
  IF v_best = 0 OR v_ties > 1 THEN RETURN NULL; END IF;
  FOR i IN 1 .. n LOOP
    IF (v_best_mask & (1 << (i - 1))) <> 0 THEN v_out := v_out || p_ids[i]; END IF;
  END LOOP;
  RETURN v_out;
END;
$function$;

-- Come sopra ma con un numero preciso di buste (il «NUM. TOT. PAGAMENTI» della
-- banca) e fino a 30 buste: serve quando una disposizione mescola persone di
-- filiali diverse, dopo che le filiali intere sono gia' state agganciate.
-- Gli importi sono positivi, quindi le somme parziali oltre la cifra si scartano
-- subito. Una sola combinazione valida, o nessun aggancio.
CREATE OR REPLACE FUNCTION public.fn_payroll_subset_k(p_ids uuid[], p_amts numeric[], p_target numeric, p_k integer)
RETURNS uuid[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH RECURSIVE it AS (
    SELECT i, round(p_amts[i], 2) AS a FROM generate_subscripts(p_ids, 1) i
  ), c AS (
    SELECT ARRAY[i] AS idx, a AS s, 1 AS n FROM it WHERE a <= p_target + 0.005
    UNION ALL
    SELECT c.idx || it.i, c.s + it.a, c.n + 1
    FROM c JOIN it ON it.i > c.idx[array_length(c.idx, 1)]
    WHERE c.n < p_k AND c.s + it.a <= p_target + 0.005
  ), hit AS (
    SELECT idx FROM c WHERE n = p_k AND round(s, 2) = round(p_target, 2) LIMIT 2
  )
  SELECT CASE
    WHEN p_k IS NULL OR p_k < 1 OR COALESCE(array_length(p_ids, 1), 0) > 30 THEN NULL
    WHEN (SELECT count(*) FROM hit) = 1 THEN (SELECT array_agg(p_ids[x]) FROM hit, unnest(hit.idx) x)
  END
$function$;

-- Importo italiano «6.305,12» → 6305.12
CREATE OR REPLACE FUNCTION public.fn_it_num(p text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN p IS NULL OR btrim(p) = '' THEN NULL
              ELSE replace(replace(btrim(p), '.', ''), ',', '.')::numeric END
$function$;

-- Scadenza F24: il 16 del mese dopo il periodo; sabato e domenica slittano al lunedi'.
CREATE OR REPLACE FUNCTION public.fn_f24_scadenza(p_periodo date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT d + CASE extract(isodow FROM d) WHEN 6 THEN 2 WHEN 7 THEN 1 ELSE 0 END
  FROM (SELECT (date_trunc('month', p_periodo) + interval '1 month' + interval '15 days')::date AS d) s
$function$;

-- ── 4b. il motore ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_payroll_sync(p_company uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  f record;
  g record;
  p record;
  v_target numeric;
  v_comm numeric;
  v_nbon int;
  v_cbi text;
  v_match uuid[];
  v_y int;
  v_m int;
  v_k int;
  v_giro int;
  v_amts_bt numeric[];
  v_sub uuid[];
  v_ids uuid[];
  v_amts numeric[];
  v_links int := 0;
  v_flussi int := 0;
  v_domande int := 0;
  v_scad date;
  v_bt uuid[];
  v_pagato numeric;
  v_esito text;
  v_f24 int := 0;
  v_mesi text[] := ARRAY['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
BEGIN
  IF p_company IS NULL THEN RETURN jsonb_build_object('errore', 'azienda mancante'); END IF;

  -- 1) Disposizioni emolumenti degli ultimi 6 mesi non ancora agganciate.
  --    Giro 1: solo dentro la stessa filiale. Giro 2: fra tutte le buste rimaste
  --    del mese, che a quel punto sono poche.
  FOR v_giro IN 1 .. 2 LOOP
  FOR f IN
    SELECT b.id, b.transaction_date AS d, b.amount, COALESCE(b.description, '') AS descr
    FROM public.bank_transactions b
    WHERE b.company_id = p_company AND b.amount < 0 AND b.category = 'stipendi'
      AND b.transaction_date >= current_date - 185
      AND NOT EXISTS (SELECT 1 FROM public.payroll_payment_links l WHERE l.bank_transaction_id = b.id)
    ORDER BY b.transaction_date, b.amount
  LOOP
    IF v_giro = 1 THEN v_flussi := v_flussi + 1; END IF;
    v_target := public.fn_it_num((regexp_match(f.descr, 'IMPORTO BONIFICI:\s*([\d.]+,\d{2})', 'i'))[1]);
    v_comm := public.fn_it_num((regexp_match(f.descr, 'IMPORTO COMMISSIONI:\s*([\d.]+,\d{2})', 'i'))[1]);
    v_nbon := ((regexp_match(f.descr, 'NUM\.?\s*TOT\.?\s*PAGAMENTI:\s*(\d+)', 'i'))[1])::int;
    v_cbi := (regexp_match(f.descr, 'ID FLUSSO CBI:\s*(\d+)', 'i'))[1];
    IF v_target IS NULL THEN v_target := round(-f.amount, 2); END IF;
    v_match := NULL;

    -- Mese prima del pagamento, poi stesso mese.
    FOR v_k IN 0 .. 1 LOOP
      v_y := extract(year FROM (date_trunc('month', f.d) - make_interval(months => 1 - v_k)))::int;
      v_m := extract(month FROM (date_trunc('month', f.d) - make_interval(months => 1 - v_k)))::int;
      -- Prima filiale e tipo di cedolino insieme (la 14ª si paga a parte dalla
      -- mensilita'), poi la sola filiale.
      FOR g IN
        SELECT 1 AS pass, COALESCE(s.outlet_code, '?') AS o, s.tipo AS t,
               array_agg(s.id ORDER BY s.netto DESC, s.id) AS ids,
               array_agg(round(s.netto, 2) ORDER BY s.netto DESC, s.id) AS amts
        FROM public.employee_cost_slips s
        WHERE s.company_id = p_company AND s.year = v_y AND s.month = v_m AND COALESCE(s.netto, 0) > 0
          AND NOT EXISTS (SELECT 1 FROM public.payroll_payment_links l WHERE l.slip_id = s.id)
        GROUP BY 2, 3
        UNION ALL
        SELECT 2 AS pass, COALESCE(s.outlet_code, '?') AS o, NULL AS t,
               array_agg(s.id ORDER BY s.netto DESC, s.id) AS ids,
               array_agg(round(s.netto, 2) ORDER BY s.netto DESC, s.id) AS amts
        FROM public.employee_cost_slips s
        WHERE s.company_id = p_company AND s.year = v_y AND s.month = v_m AND COALESCE(s.netto, 0) > 0
          AND NOT EXISTS (SELECT 1 FROM public.payroll_payment_links l WHERE l.slip_id = s.id)
        GROUP BY 2
        HAVING count(DISTINCT s.tipo) > 1
        ORDER BY 1, 2, 3
      LOOP
        EXIT WHEN v_giro = 2;
        v_match := public.fn_payroll_subset(g.ids, g.amts, v_target);
        EXIT WHEN v_match IS NOT NULL;
      END LOOP;
      IF v_match IS NULL AND v_giro = 2 THEN
        SELECT array_agg(s.id ORDER BY s.netto DESC, s.id), array_agg(round(s.netto, 2) ORDER BY s.netto DESC, s.id)
          INTO v_ids, v_amts
        FROM public.employee_cost_slips s
        WHERE s.company_id = p_company AND s.year = v_y AND s.month = v_m AND COALESCE(s.netto, 0) > 0
          AND NOT EXISTS (SELECT 1 FROM public.payroll_payment_links l WHERE l.slip_id = s.id);
        v_match := public.fn_payroll_subset(v_ids, v_amts, v_target);
        IF v_match IS NULL THEN v_match := public.fn_payroll_subset_k(v_ids, v_amts, v_target, v_nbon); END IF;
      END IF;
      EXIT WHEN v_match IS NOT NULL;
    END LOOP;

    IF v_match IS NOT NULL THEN
      INSERT INTO public.payroll_payment_links (company_id, slip_id, bank_transaction_id, year, month, tipo, outlet_code, netto,
                                               id_flusso, importo_bonifici, commissioni, n_bonifici)
      SELECT p_company, s.id, f.id, s.year, s.month, s.tipo, s.outlet_code, round(s.netto, 2), v_cbi, v_target, v_comm, v_nbon
      FROM public.employee_cost_slips s WHERE s.id = ANY (v_match)
      ON CONFLICT (slip_id) DO NOTHING;
      v_links := v_links + array_length(v_match, 1);
    ELSIF v_giro = 2 AND f.d >= current_date - 60 AND f.d <= current_date - 3 THEN
      -- Si chiede solo se le buste del mese prima ci sono gia': senza, manca
      -- un caricamento, non un'informazione.
      v_y := extract(year FROM (date_trunc('month', f.d) - interval '1 month'))::int;
      v_m := extract(month FROM (date_trunc('month', f.d) - interval '1 month'))::int;
      IF EXISTS (SELECT 1 FROM public.employee_cost_slips s WHERE s.company_id = p_company AND s.year = v_y AND s.month = v_m) THEN
        IF public.fn_bank_doc_ask(p_company, NULL, 'stipendio_non_abbinato', 'stip-flusso:' || f.id, f.id,
             format('La disposizione per emolumenti del %s di %s%s non corrisponde a nessun gruppo di buste paga di %s %s o del mese dopo. A chi si riferisce?',
                    to_char(f.d, 'DD/MM/YYYY'), public.fn_eur_it(v_target),
                    CASE WHEN v_nbon IS NOT NULL THEN ' (' || v_nbon || CASE WHEN v_nbon = 1 THEN ' bonifico)' ELSE ' bonifici)' END ELSE '' END,
                    v_mesi[v_m], v_y),
             jsonb_build_object('importo_bonifici', v_target, 'id_flusso', v_cbi)) THEN
          v_domande := v_domande + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;
  END LOOP;

  -- 1b) Una filiale intera senza pagamento, quando le altre dello stesso mese
  --     sono state pagate e il 25 del mese dopo e' passato. Una sola busta
  --     scoperta non fa domanda: puo' essere pagata in contanti o a parte.
  FOR g IN
    SELECT s.year, s.month, COALESCE(s.outlet_code, '?') AS o, count(*) AS n, round(sum(s.netto), 2) AS tot
    FROM public.employee_cost_slips s
    LEFT JOIN public.payroll_payment_links l ON l.slip_id = s.id
    WHERE s.company_id = p_company AND COALESCE(s.netto, 0) > 0
      AND make_date(s.year, s.month, 1) >= date_trunc('month', current_date - 90)::date
    GROUP BY 1, 2, 3
    HAVING count(l.id) = 0
  LOOP
    IF current_date > (make_date(g.year, g.month, 1) + interval '1 month' + interval '24 days')::date
       AND EXISTS (SELECT 1 FROM public.payroll_payment_links l WHERE l.company_id = p_company AND l.year = g.year AND l.month = g.month) THEN
      IF public.fn_bank_doc_ask(p_company, NULL, 'buste_non_pagate', 'stip-buste:' || g.year || '-' || g.month || ':' || g.o, NULL,
           format('Le buste paga di %s %s di %s (%s %s, %s in tutto) non trovano una disposizione in banca, mentre le altre filiali risultano pagate. Sono state pagate in un altro modo o da un altro conto?',
                  v_mesi[g.month], g.year, g.o, g.n, CASE WHEN g.n = 1 THEN 'persona' ELSE 'persone' END, public.fn_eur_it(g.tot)),
           jsonb_build_object('year', g.year, 'month', g.month, 'outlet_code', g.o)) THEN
        v_domande := v_domande + 1;
      END IF;
    END IF;
  END LOOP;

  -- 2) F24 del personale: atteso dal Prospetto, cercato in banca intorno alla scadenza.
  FOR p IN
    SELECT i.periodo, round(sum(i.importo), 2) AS atteso
    FROM public.payroll_f24_items i
    WHERE i.company_id = p_company AND i.canale = 'f24'
      -- solo l'ultimo caricamento di ogni mese del Prospetto
      AND i.batch_id = (SELECT j.batch_id FROM public.payroll_f24_items j
                        WHERE j.company_id = i.company_id AND j.year = i.year AND j.month = i.month
                        ORDER BY j.created_at DESC, j.batch_id LIMIT 1)
    GROUP BY 1
  LOOP
    v_f24 := v_f24 + 1;
    v_scad := public.fn_f24_scadenza(p.periodo);
    -- Deleghe gia' usate per un altro periodo non contano due volte.
    SELECT array_agg(b.id ORDER BY b.transaction_date, b.id), round(sum(-b.amount), 2),
           array_agg(round(-b.amount, 2) ORDER BY b.transaction_date, b.id)
      INTO v_bt, v_pagato, v_amts_bt
    FROM public.bank_transactions b
    WHERE b.company_id = p_company AND b.amount < 0
      AND b.transaction_date BETWEEN v_scad - 3 AND v_scad + 7
      AND upper(COALESCE(b.description, '') || ' ' || COALESCE(b.statement_description, '')) ~ '(\yF24\y|DELEGA|DELEGHE)'
      AND NOT EXISTS (SELECT 1 FROM public.payroll_f24_checks k
                      WHERE k.company_id = p_company AND k.periodo <> p.periodo AND b.id = ANY (k.bank_transaction_ids));
    -- Se alcune deleghe fanno esattamente la cifra, sono quelle del personale.
    -- Altrimenti le deleghe portano anche altro (IVA, ritenute): si tengono tutte
    -- quelle della finestra e si guarda che coprano la quota paghe.
    v_sub := CASE WHEN v_bt IS NOT NULL THEN public.fn_payroll_subset(v_bt, v_amts_bt, p.atteso) END;
    IF v_sub IS NOT NULL THEN
      v_bt := v_sub; v_pagato := p.atteso;
    END IF;
    IF v_bt IS NULL THEN
      v_esito := CASE WHEN current_date > v_scad + 5 THEN 'da_chiarire' ELSE 'in_attesa' END;
    ELSIF v_pagato >= p.atteso - 1 THEN
      v_esito := CASE WHEN abs(v_pagato - p.atteso) <= 1 THEN 'pagato' ELSE 'pagato_con_altre_voci' END;
    ELSE
      v_esito := CASE WHEN current_date > v_scad + 5 THEN 'da_chiarire' ELSE 'in_attesa' END;
    END IF;

    INSERT INTO public.payroll_f24_checks (company_id, periodo, scadenza, atteso, pagato, bank_transaction_ids, esito, updated_at)
    VALUES (p_company, p.periodo, v_scad, p.atteso, v_pagato, COALESCE(v_bt, '{}'), v_esito, now())
    ON CONFLICT (company_id, periodo) DO UPDATE SET
      scadenza = EXCLUDED.scadenza, atteso = EXCLUDED.atteso, pagato = EXCLUDED.pagato,
      bank_transaction_ids = EXCLUDED.bank_transaction_ids, esito = EXCLUDED.esito, updated_at = now();

    IF v_esito = 'da_chiarire' AND v_scad >= current_date - 90 THEN
      IF public.fn_bank_doc_ask(p_company, NULL, 'f24_paghe', 'f24-paghe:' || p.periodo, NULL,
           CASE WHEN v_bt IS NULL THEN
             format('Il Prospetto paghe di %s %s chiede %s di F24 (contributi e ritenute del personale) entro il %s, ma in banca fra il %s e il %s non trovo deleghe F24. È stato pagato da un altro conto o in un''altra data?',
                    v_mesi[extract(month FROM p.periodo)::int], extract(year FROM p.periodo)::int, public.fn_eur_it(p.atteso),
                    to_char(v_scad, 'DD/MM/YYYY'), to_char(v_scad - 3, 'DD/MM/YYYY'), to_char(v_scad + 7, 'DD/MM/YYYY'))
           ELSE
             format('Il Prospetto paghe di %s %s chiede %s di F24 entro il %s, ma le deleghe pagate intorno a quella data fanno %s. Manca una parte o è stata compensata con un credito?',
                    v_mesi[extract(month FROM p.periodo)::int], extract(year FROM p.periodo)::int, public.fn_eur_it(p.atteso),
                    to_char(v_scad, 'DD/MM/YYYY'), public.fn_eur_it(v_pagato))
           END,
           jsonb_build_object('periodo', p.periodo, 'atteso', p.atteso, 'pagato', v_pagato)) THEN
        v_domande := v_domande + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('disposizioni_esaminate', v_flussi, 'buste_agganciate', v_links,
                            'periodi_f24', v_f24, 'domande_nuove', v_domande);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_payroll_sync(uuid) FROM PUBLIC, anon, authenticated;

-- ── 5. ingressi ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.payroll_sync_now()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_role text := public.get_my_role()::text;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'Nessuna azienda associata all''utente'; END IF;
  IF COALESCE(v_role, '') NOT IN ('super_advisor', 'cfo', 'contabile') THEN
    RAISE EXCEPTION 'Ruolo % non abilitato', v_role;
  END IF;
  RETURN public.fn_payroll_sync(v_company);
END;
$function$;
REVOKE ALL ON FUNCTION public.payroll_sync_now() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_sync_now() TO authenticated;

-- Salva le voci di versamento di un Prospetto come nuova versione del mese (il
-- Prospetto ricaricato e' quello buono; i precedenti restano), poi riallinea i
-- controlli.
-- p_items: [{filiale_code, codice, descrizione, canale, periodo: 'YYYY-MM', importo}]
CREATE OR REPLACE FUNCTION public.save_payroll_f24_items(p_import_id uuid, p_year integer, p_month integer, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_role text := public.get_my_role()::text;
  v_n int;
  v_batch uuid := gen_random_uuid();
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'Nessuna azienda associata all''utente'; END IF;
  IF COALESCE(v_role, '') NOT IN ('super_advisor', 'cfo', 'contabile') THEN
    RAISE EXCEPTION 'Ruolo % non abilitato', v_role;
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Voci mancanti'; END IF;
  IF p_import_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.personnel_gross_cost_imports WHERE id = p_import_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Caricamento % non trovato', p_import_id;
  END IF;

  INSERT INTO public.payroll_f24_items (company_id, import_id, year, month, filiale_code, codice, descrizione, canale, periodo, importo, batch_id)
  SELECT v_company, p_import_id, p_year, p_month,
         NULLIF(x->>'filiale_code', ''), NULLIF(x->>'codice', ''), COALESCE(NULLIF(x->>'descrizione', ''), '—'),
         CASE WHEN x->>'canale' = 'fondo' THEN 'fondo' ELSE 'f24' END,
         to_date(x->>'periodo', 'YYYY-MM'), round((x->>'importo')::numeric, 2), v_batch
  FROM jsonb_array_elements(p_items) x
  WHERE NULLIF(x->>'periodo', '') IS NOT NULL AND (x->>'importo') IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('voci', v_n, 'sync', public.fn_payroll_sync(v_company));
END;
$function$;
REVOKE ALL ON FUNCTION public.save_payroll_f24_items(uuid, integer, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_payroll_f24_items(uuid, integer, integer, jsonb) TO authenticated;

-- Per il cron: tutte le aziende che hanno buste paga o voci F24.
CREATE OR REPLACE FUNCTION public.payroll_sync_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE c record; v_out jsonb := '[]'::jsonb;
BEGIN
  FOR c IN SELECT company_id FROM public.employee_cost_slips UNION SELECT company_id FROM public.payroll_f24_items LOOP
    v_out := v_out || jsonb_build_object('company_id', c.company_id, 'esito', public.fn_payroll_sync(c.company_id));
  END LOOP;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.payroll_sync_all() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Cron giornaliero, dopo la sincronizzazione bancaria delle 06:00 UTC e la
-- riconciliazione delle 05:45: alle 07:20 UTC (09:20 ora di Roma d'estate).
SELECT cron.schedule('payroll-sync-daily', '20 7 * * *', 'SELECT public.payroll_sync_all();');

-- --- Verifica ---------------------------------------------------------------
-- select year, month, count(*), sum(netto) from payroll_payment_links group by 1,2 order by 1,2;
-- Atteso su NZ dopo il primo giro: agosto 2026 = 66.655,39 su 42 buste (9 disposizioni).
