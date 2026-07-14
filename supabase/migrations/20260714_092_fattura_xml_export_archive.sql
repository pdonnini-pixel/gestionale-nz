-- Migrazione 092 — Archivio conversioni Excel→XML Fattura Elettronica
--
-- Tabella dedicata che conserva ogni XML generato dal convertitore
-- (/fatturazione/converti-xml). Ogni "Genera XML" crea un batch (batch_id) e
-- una riga per fattura con metadati + contenuto XML, così i file restano
-- archiviati e ri-scaricabili. Isolamento per company_id (RLS come
-- active_invoices/electronic_invoices).
--
-- Additiva. Nessuna perdita dati.

CREATE TABLE IF NOT EXISTS public.fattura_xml_export (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- company_id valorizzato dal DB via get_my_company_id() (da user_profiles):
  -- coincide sempre con la RLS, il frontend non deve passarlo.
  company_id     uuid NOT NULL DEFAULT get_my_company_id() REFERENCES public.companies(id),
  batch_id       uuid NOT NULL,
  progressivo    integer NOT NULL,
  file_name      text NOT NULL,
  invoice_number text,
  invoice_date   date,
  client_name    text,
  imponibile     numeric(14,2),
  imposta        numeric(14,2),
  totale         numeric(14,2),
  quadra         boolean,
  xml_content    text NOT NULL,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fattura_xml_export_company
  ON public.fattura_xml_export (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fattura_xml_export_batch
  ON public.fattura_xml_export (batch_id);

ALTER TABLE public.fattura_xml_export ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fattura_xml_export_select ON public.fattura_xml_export;
CREATE POLICY fattura_xml_export_select ON public.fattura_xml_export
  FOR SELECT USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS fattura_xml_export_write ON public.fattura_xml_export;
CREATE POLICY fattura_xml_export_write ON public.fattura_xml_export
  FOR ALL USING (
    company_id = get_my_company_id()
    AND get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fattura_xml_export TO authenticated;
