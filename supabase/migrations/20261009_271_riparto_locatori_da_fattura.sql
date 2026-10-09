-- Migrazione 271 — regola di riparto DIRETTA per i locatori, ricavata dalle fatture
--
-- Perché: l'88% dei costi fatturati del 2026 (NZ) è di fornitori senza outlet
-- (centro «tutti», nessuna regola di riparto). Per gli affitti l'outlet si legge
-- dal documento: ogni fattura del locatore nomina il punto vendita. Regola
-- «niente liste da compilare a mano»: se il dato è nel documento, lo scrive il
-- sistema.
--
-- Cosa fa (solo INSERT, nessun dato esistente modificato):
--   per ogni fornitore con categoria di default nel gruppo «locazione»,
--   centro di costo «tutti» o vuoto e NESSUNA regola di riparto attiva,
--   se TUTTE le sue fatture con XML nominano uno e un solo outlet attivo,
--   sempre lo stesso, crea una regola DIRETTO al 100% su quell'outlet
--   (stesse tabelle e stessa forma della scheda Fornitori → Riparto).
-- Il blocco del cessionario (i dati dell'azienda cliente) è escluso dalla
-- ricerca, così l'indirizzo della sede non conta come outlet.
-- Un outlet si riconosce dalle parole del suo nome lunghe almeno 5 lettere,
-- esclusi termini generici. Nessun nome, id o P.IVA scritto a mano: vale su
-- ogni tenant. Dove nessun fornitore soddisfa tutte le condizioni non fa nulla.
-- Provenienza: description della regola «Automatica: …», created_by NULL.
-- Idempotente: un fornitore che ha già una regola attiva non viene toccato.

DO $$
DECLARE
  r record;
  v_rule uuid;
BEGIN
  FOR r IN
    WITH o AS (
      SELECT o.id, o.company_id, o.name,
        (SELECT string_agg(w, '|')
           FROM unnest(regexp_split_to_array(lower(o.name), '[^a-z]+')) w
          WHERE length(w) >= 5
            AND w NOT IN ('outlet','village','fashion','store','magazzino','ufficio','negozio','punto','vendita')) AS kw
      FROM public.outlets o
      WHERE o.is_active
    ),
    land AS (
      SELECT s.id, s.company_id, s.name
      FROM public.suppliers s
      JOIN public.cost_categories cc ON cc.id = s.default_cost_category_id
      WHERE cc.macro_group = 'locazione'
        AND coalesce(nullif(s.cost_center, ''), 'all') = 'all'
        AND NOT EXISTS (SELECT 1 FROM public.supplier_allocation_rules ar
                         WHERE ar.supplier_id = s.id AND ar.is_active)
    ),
    inv AS (
      SELECT DISTINCT l.id AS sup, e.id AS inv,
        lower(regexp_replace(e.xml_content, '<CessionarioCommittente>.*</CessionarioCommittente>', '', 'g')) AS x
      FROM land l
      JOIN public.payables p ON p.supplier_id = l.id
      JOIN public.electronic_invoices e ON e.id = p.electronic_invoice_id
      WHERE e.company_id = l.company_id AND coalesce(e.xml_content, '') <> ''
    ),
    hits AS (
      SELECT i.sup, i.inv, array_remove(array_agg(o.id), NULL) AS outs
      FROM inv i
      JOIN land l ON l.id = i.sup
      LEFT JOIN o ON o.company_id = l.company_id AND o.kw IS NOT NULL AND i.x ~ o.kw
      GROUP BY i.sup, i.inv
    ),
    per_sup AS (
      SELECT h.sup,
             count(*) AS n_inv,
             count(*) FILTER (WHERE cardinality(h.outs) = 1) AS n_one,
             count(DISTINCT h.outs[1]) FILTER (WHERE cardinality(h.outs) = 1) AS n_outlets,
             min(h.outs[1]::text) FILTER (WHERE cardinality(h.outs) = 1) AS outlet_id
      FROM hits h
      GROUP BY h.sup
    )
    SELECT l.id AS supplier_id, l.company_id, l.name AS supplier_name,
           ps.outlet_id::uuid AS outlet_id, o.name AS outlet_name, ps.n_inv
    FROM per_sup ps
    JOIN land l ON l.id = ps.sup
    JOIN o ON o.id = ps.outlet_id::uuid
    WHERE ps.n_inv >= 2            -- almeno due fatture: una sola non basta come prova
      AND ps.n_one = ps.n_inv      -- ogni fattura nomina un solo outlet
      AND ps.n_outlets = 1         -- e sempre lo stesso
  LOOP
    INSERT INTO public.supplier_allocation_rules (company_id, supplier_id, allocation_mode, description, is_active)
    VALUES (r.company_id, r.supplier_id, 'DIRETTO',
            format('Automatica: le %s fatture del locatore nominano solo %s (migrazione 271)', r.n_inv, r.outlet_name),
            true)
    RETURNING id INTO v_rule;

    INSERT INTO public.supplier_allocation_details (rule_id, outlet_id, percentage)
    VALUES (v_rule, r.outlet_id, 100);

    RAISE NOTICE 'Regola DIRETTO: % -> % (% fatture)', r.supplier_name, r.outlet_name, r.n_inv;
  END LOOP;
END $$;

-- Verifica:
-- SELECT s.name, o.name, r.description
-- FROM supplier_allocation_rules r
-- JOIN suppliers s ON s.id = r.supplier_id
-- JOIN supplier_allocation_details d ON d.rule_id = r.id
-- JOIN outlets o ON o.id = d.outlet_id
-- WHERE r.is_active AND r.description LIKE 'Automatica:%migrazione 271%';
