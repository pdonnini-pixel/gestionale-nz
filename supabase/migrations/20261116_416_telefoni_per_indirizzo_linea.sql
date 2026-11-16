-- =====================================================================
-- 416 — Telefoni divisi per indirizzo della linea (aziende con le parti uguali)
-- =====================================================================
-- Patrizio, 16/11/2026, per Zago: «telefoni divisi per indirizzo utenza».
--
-- Vale solo dove company_settings.riparto_parti_uguali è accesa (415: oggi
-- solo Zago). New Zago non cambia: i suoi telefoni restano come prima
-- (fatture che nominano l'outlet, poi ricavi o sede).
--
-- Per i fornitori della categoria TELEFON, fattura per fattura:
--   - si cerca nelle righe della fattura (cedente e cessionario esclusi,
--     fn_testo_fattura_ricercabile) il comune del negozio o la sua via
--     (outlets.address senza numero civico, almeno 8 caratteri);
--   - la fattura va ai negozi trovati, in parti uguali se sono più di uno;
--   - una fattura senza indirizzo riconoscibile (es. le linee mobili, che
--     non hanno un indirizzo di utenza) va in parti uguali fra i negozi.
-- Misura del 16/11/2026 sui telefoni di New Zago (solo per provare la
-- ricerca, NZ non usa questo passaggio): Fastweb 6 fatture su 7 riconosciute
-- dall'indirizzo, Wind Tre 0 su 5 (linee mobili).
-- Zago al 16/11/2026 non ha ancora fatture d'acquisto: il passaggio partirà
-- con le prime fatture dal cassetto.
--
-- Stessa tecnica della 415: una sostituzione verificata nella definizione
-- attuale (md5 40bc01d3cbd7554881d2832b4a3ec863 su NZ e Zago), idempotente.
-- Rollback: 20261116_416_telefoni_per_indirizzo_linea_ROLLBACK.sql
-- =====================================================================

DO $migr$
DECLARE
  v_def text := pg_get_functiondef('public.fn_riparto_automatico(uuid,boolean)'::regprocedure);
  a1 text := E'    -- 2. Outlet nominato in ogni fattura\n';
  b1 text := E'    -- 1c. Telefoni, se l\'azienda ha scelto le parti uguali (migrazione 416):\n'
          || E'    --     ogni fattura va al negozio della linea (comune o via nelle righe);\n'
          || E'    --     senza indirizzo riconoscibile, in parti uguali fra i negozi.\n'
          || E'    IF v_want IS NULL AND v_parti_uguali AND s.cat_code = \'TELEFON\'\n'
          || E'       AND v_negozi IS NOT NULL AND (SELECT count(*) FROM jsonb_object_keys(v_negozi)) >= 2 THEN\n'
          || E'      WITH inv AS (\n'
          || E'        SELECT DISTINCT ON (e.id) e.id AS inv_id, abs(coalesce(e.net_amount, 0)) AS net,\n'
          || E'               public.fn_testo_fattura_ricercabile(e.xml_content) AS txt\n'
          || E'        FROM public.payables p\n'
          || E'        JOIN public.electronic_invoices e ON e.id = p.electronic_invoice_id\n'
          || E'        WHERE p.supplier_id = s.id AND e.company_id = p_company_id\n'
          || E'          AND e.invoice_date >= v_from AND coalesce(e.xml_content, \'\') <> \'\'\n'
          || E'      ),\n'
          || E'      ng AS (\n'
          || E'        SELECT o.id AS outlet_id,\n'
          || E'               lower(trim(coalesce(o.city, \'\'))) AS comune,\n'
          || E'               trim(regexp_replace(lower(split_part(coalesce(o.address, \'\'), \',\', 1)),\n'
          || E'                    \'\\s*[0-9][0-9a-z/ -]*$\', \'\')) AS via\n'
          || E'        FROM public.outlets o WHERE v_negozi ? o.id::text\n'
          || E'      ),\n'
          || E'      h AS (\n'
          || E'        SELECT i.inv_id, i.net,\n'
          || E'               array(SELECT n.outlet_id FROM ng n\n'
          || E'                      WHERE (length(n.comune) >= 3 AND position(n.comune IN i.txt) > 0)\n'
          || E'                         OR (length(n.via) >= 8 AND position(n.via IN i.txt) > 0)) AS outs\n'
          || E'        FROM inv i\n'
          || E'      ),\n'
          || E'      w AS (\n'
          || E'        SELECT x.o, sum(x.a) AS a FROM (\n'
          || E'          SELECT unnest(outs) AS o, net / cardinality(outs) AS a FROM h WHERE cardinality(outs) > 0\n'
          || E'          UNION ALL\n'
          || E'          SELECT k::uuid, h.net / (SELECT count(*) FROM jsonb_object_keys(v_negozi))\n'
          || E'          FROM h CROSS JOIN jsonb_object_keys(v_negozi) k WHERE cardinality(h.outs) = 0\n'
          || E'        ) x GROUP BY x.o\n'
          || E'      )\n'
          || E'      SELECT CASE WHEN (SELECT count(*) FROM h) > 0\n'
          || E'                  THEN (SELECT jsonb_object_agg(o, a) FROM w WHERE a > 0) END,\n'
          || E'             format(\'telefoni, negozio dell\'\'indirizzo della linea (%s fatture su %s, le altre in parti uguali)\',\n'
          || E'                    (SELECT count(*) FROM h WHERE cardinality(outs) > 0), (SELECT count(*) FROM h))\n'
          || E'        INTO v_want, v_motivo;\n'
          || E'      IF v_want IS NULL THEN\n'
          || E'        v_motivo := NULL;\n'
          || E'      END IF;\n'
          || E'    END IF;\n\n'
          || E'    -- 2. Outlet nominato in ogni fattura\n';
BEGIN
  IF position('migrazione 416' IN v_def) > 0 THEN
    RAISE NOTICE '416: funzione già aggiornata, niente da fare';
    RETURN;
  END IF;
  IF position('v_parti_uguali' IN v_def) = 0
     OR (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1 THEN
    RAISE EXCEPTION '416: la definizione di fn_riparto_automatico non è quella attesa (serve la 415), nessuna modifica';
  END IF;
  EXECUTE replace(v_def, a1, b1);
END
$migr$;
