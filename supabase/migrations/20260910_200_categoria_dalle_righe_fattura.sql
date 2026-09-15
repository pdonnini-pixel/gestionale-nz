-- 20260910_200 — La categoria si legge anche dalle RIGHE della fattura.
--
-- PERCHÉ (Patrizio, 10/09/2026). Una fattura di BELLUCO con una riga sola, «GASOLIO»
-- 94,52 €, restava «Non categorizzata» e quindi «Bonifico ordinario» aperto in scadenzario.
-- Il campo per le parole chiave esisteva già (cost_categories.matching_keywords) ma non lo
-- leggeva nessuno: fn_auto_categorize_payable guardava solo la categoria predefinita del
-- FORNITORE. E quella strada, sui dati veri, non copre il caso: delle 69 scadenze aperte
-- senza categoria, ZERO si risolvevano dallo storico, perché appartengono a 37 fornitori
-- occasionali che non hanno mai avuto una fattura categorizzata. Per loro l'unica
-- informazione disponibile è cosa c'è scritto nella fattura.
--
-- COSA FA
--   1. fn_invoice_lines_text  — estrae il testo delle sole DESCRIZIONI DI RIGA, nei due
--      formati (JSON del bridge A-Cube e XML puro). Solo le righe: cercare le parole in
--      tutto il documento prenderebbe nomi, indirizzi e causali.
--   2. fn_categorize_from_lines — confronta quel testo con le matching_keywords delle
--      categorie. Vince la categoria che ricorre di PIÙ nelle righe, non quella con la
--      parola più lunga: la prima versione sbagliava 5 fatture su 25 proprio così
--      (REALCART e faliero finivano in Spedizioni per una riga di porto, AXET e UnipolTech
--      in Locazione per la parola «canone»). A parità di occorrenze decide la parola più
--      specifica; se resta un pareggio non si sceglie. In più una regola di prudenza: una
--      parola sola dentro una fattura articolata (più di 120 caratteri di righe) non
--      decide, perché è quasi sempre una voce accessoria e non il tema della fornitura.
--   3. fn_auto_categorize_payable — invariata nella priorità (prima il fornitore, che è
--      più affidabile), con le righe come ripiego quando il fornitore non dice niente.
--   4. rpc_categorize_from_lines_backlog — recupero delle fatture già a sistema, a mano,
--      per contabile e super_advisor.
--
-- La catena col pagamento non va toccata: appena la categoria arriva, il trigger
-- fn_payable_auto_debit gira nella stessa transazione e sistema metodo e scadenza (R16).
--
-- Parole chiave aggiunte per sei categorie, concordate su fatture reali, scritte come
-- RADICI («pulizi» prende pulizia, pulizie, pulizio) e senza termini generici come
-- «canone» o «spedizione», che pescavano righe accessorie. Le altre categorie restano
-- come sono. Additiva. Rollback in _ROLLBACK.sql

-- ── 1. testo delle sole righe ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_invoice_lines_text(p_xml text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT lower(coalesce(
    (SELECT string_agg(m[1], ' ') FROM regexp_matches(coalesce(p_xml, ''), '"descrizione":\s*"([^"]*)"', 'g') m),
    '') || ' ' || coalesce(
    (SELECT string_agg(m[1], ' ') FROM regexp_matches(coalesce(p_xml, ''), '<Descrizione>([^<]*)</Descrizione>', 'g') m),
    ''));
$function$;

-- ── 2. categoria dalle parole chiave ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_categorize_from_lines(p_company_id uuid, p_xml text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_text  text;
  v_len   int;
  v_best  uuid := NULL;
  v_occ   int := 0;
  v_spec  int := 0;
  v_ties  int := 0;
  r RECORD;
BEGIN
  v_text := public.fn_invoice_lines_text(p_xml);
  IF v_text IS NULL OR length(btrim(v_text)) < 3 THEN
    RETURN NULL;
  END IF;
  v_len := length(v_text);

  FOR r IN
    SELECT c.id,
           sum((SELECT count(*) FROM regexp_matches(v_text,
                 '\m' || regexp_replace(lower(k), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g'), 'g'))) AS occorrenze,
           max(length(k)) AS specificita
      FROM public.cost_categories c, unnest(c.matching_keywords) AS k
     WHERE c.company_id = p_company_id
       AND COALESCE(c.is_active, true)
       AND c.matching_keywords IS NOT NULL
       AND length(k) >= 4
     GROUP BY c.id
    HAVING sum((SELECT count(*) FROM regexp_matches(v_text,
                 '\m' || regexp_replace(lower(k), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g'), 'g'))) > 0
     ORDER BY 2 DESC, 3 DESC
  LOOP
    IF r.occorrenze > v_occ OR (r.occorrenze = v_occ AND r.specificita > v_spec) THEN
      v_best := r.id; v_occ := r.occorrenze; v_spec := r.specificita; v_ties := 1;
    ELSIF r.occorrenze = v_occ AND r.specificita = v_spec THEN
      v_ties := v_ties + 1;
    END IF;
  END LOOP;

  IF v_ties <> 1 THEN RETURN NULL; END IF;
  -- Una parola sola dentro una fattura articolata non basta: è quasi sempre una riga
  -- accessoria (spese di spedizione, interessi, bolli) e non il tema della fornitura.
  IF v_occ < 2 AND v_len > 120 THEN RETURN NULL; END IF;
  RETURN v_best;
END;
$function$;

-- ── 3. il trigger di categorizzazione usa le righe come ripiego ──────────────
CREATE OR REPLACE FUNCTION public.fn_auto_categorize_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_xml text;
BEGIN
  IF NEW.cost_category_id IS NULL THEN
    -- Prima prova per supplier_id
    IF NEW.supplier_id IS NOT NULL THEN
      SELECT default_cost_category_id INTO NEW.cost_category_id
      FROM suppliers
      WHERE id = NEW.supplier_id
        AND default_cost_category_id IS NOT NULL;
    END IF;
    -- Se ancora NULL, prova per supplier_vat
    IF NEW.cost_category_id IS NULL AND NEW.supplier_vat IS NOT NULL AND NEW.supplier_vat != '' THEN
      SELECT default_cost_category_id INTO NEW.cost_category_id
      FROM suppliers
      WHERE (vat_number = NEW.supplier_vat OR partita_iva = NEW.supplier_vat)
        AND company_id = NEW.company_id
        AND default_cost_category_id IS NOT NULL
      LIMIT 1;
    END IF;
    -- Se ancora NULL, prova per supplier_name
    IF NEW.cost_category_id IS NULL AND NEW.supplier_name IS NOT NULL AND NEW.supplier_name != '' THEN
      SELECT default_cost_category_id INTO NEW.cost_category_id
      FROM suppliers
      WHERE (name = NEW.supplier_name OR ragione_sociale = NEW.supplier_name)
        AND company_id = NEW.company_id
        AND default_cost_category_id IS NOT NULL
      LIMIT 1;
    END IF;
    -- Ultimo ripiego: cosa c'è scritto nelle righe della fattura.
    IF NEW.cost_category_id IS NULL AND NEW.electronic_invoice_id IS NOT NULL THEN
      SELECT e.xml_content INTO v_xml
        FROM public.electronic_invoices e WHERE e.id = NEW.electronic_invoice_id;
      NEW.cost_category_id := public.fn_categorize_from_lines(NEW.company_id, v_xml);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 4. recupero delle fatture già a sistema ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_categorize_from_lines_backlog(p_only_open boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_company uuid;
  v_role text;
  v_n integer := 0;
  r RECORD;
  v_cat uuid;
BEGIN
  SELECT company_id, role INTO v_company, v_role
  FROM public.user_profiles WHERE id = auth.uid();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Company non determinata per l''utente corrente';
  END IF;
  IF COALESCE(v_role, '') NOT IN ('super_advisor', 'contabile') THEN
    RAISE EXCEPTION 'Non autorizzato: serve il ruolo contabile o super_advisor';
  END IF;

  FOR r IN
    SELECT p.id, e.xml_content
      FROM public.payables p
      JOIN public.electronic_invoices e ON e.id = p.electronic_invoice_id
     WHERE p.company_id = v_company
       AND p.cost_category_id IS NULL
       AND (NOT p_only_open OR p.status IN ('da_pagare','in_scadenza','scaduto','parziale'))
  LOOP
    v_cat := public.fn_categorize_from_lines(v_company, r.xml_content);
    IF v_cat IS NOT NULL THEN
      UPDATE public.payables SET cost_category_id = v_cat, updated_at = now() WHERE id = r.id;
      v_n := v_n + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('categorizzate_dalle_righe', v_n, 'company_id', v_company, 'run_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_categorize_from_lines_backlog(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_categorize_from_lines_backlog(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_categorize_from_lines_backlog(boolean) TO authenticated, service_role;

-- ── 5. le parole chiave concordate (radici, non parole intere) ───────────────
UPDATE public.cost_categories SET matching_keywords = ARRAY['gasolio','carburant','benzina','diesel','adblue','pedagg','autostrad','rifornimento']
 WHERE code = 'MEZZI_E_CARBURANTE';
UPDATE public.cost_categories SET matching_keywords = ARRAY['viaggio','trasferta','treno','aereo','hotel','coperto','pranzo','caffe','bevanda','pizza','colazione','soggiorno','ristorant']
 WHERE code = 'VIAGGI';
UPDATE public.cost_categories SET matching_keywords = ARRAY['corriere','porto franco']
 WHERE code = 'SPEDIZ';
UPDATE public.cost_categories SET matching_keywords = ARRAY['puliz','estintor','sanific','antincendio','cleaning']
 WHERE code = 'PULIZIA';
UPDATE public.cost_categories SET matching_keywords = ARRAY['cancelleri','cartoleri','toner','cartuccia','risma']
 WHERE code = 'CANCELL';
UPDATE public.cost_categories SET matching_keywords = ARRAY['manutenzion','riparazion','ricambi']
 WHERE code = 'MANUT';
UPDATE public.cost_categories SET matching_keywords = ARRAY['locazione','affitto']
 WHERE code = 'LOC_OUTLET';
