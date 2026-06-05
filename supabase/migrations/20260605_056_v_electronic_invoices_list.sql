-- 20260605_056_v_electronic_invoices_list.sql
-- PARTE 2 — Fix timeout pagina Fatturazione (fatture passive).
-- La lista scaricava tutte le colonne di electronic_invoices, incluso xml_content
-- (54 MB complessivi): causa del timeout 15s. Questa view espone tutte le colonne
-- TRANNE xml_content, piu' un flag booleano has_xml. L'XML si carica lazy per-id
-- solo al click "Visualizza" (lato frontend).
--
-- L'elenco colonne e' ricavato dinamicamente da information_schema (escluso
-- xml_content) cosi' la view non si rompe se lo schema cambia. Va ri-eseguita
-- (CREATE OR REPLACE) se in futuro si aggiungono colonne — vedi nota in fondo.
--
-- security_invoker=true => rispetta la RLS di electronic_invoices (isolamento
-- company_id), identico a v_fornitori_kpi. Replicabile su NZ/Made/Zago. Non distruttivo.
DO $$
DECLARE
  col_list text;
BEGIN
  SELECT string_agg('e.' || quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO col_list
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'electronic_invoices'
    AND column_name <> 'xml_content';

  EXECUTE format(
    'CREATE OR REPLACE VIEW public.v_electronic_invoices_list '
    'WITH (security_invoker = true) AS '
    'SELECT %s, (e.xml_content IS NOT NULL) AS has_xml '
    'FROM public.electronic_invoices e',
    col_list
  );
END $$;

-- Stessi grant di v_fornitori_kpi (lettura per i ruoli applicativi).
GRANT SELECT ON public.v_electronic_invoices_list TO anon, authenticated, service_role;
