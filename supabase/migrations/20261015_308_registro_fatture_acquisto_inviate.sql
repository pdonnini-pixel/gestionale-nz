-- Migrazione 308 — registro delle fatture acquisto già consegnate allo studio (15/10/2026)
--
-- Chiesto da Patrizio il 15/10/2026. Ogni mese allo Studio Poli (Monica) va il
-- file «Fatture acquisto»: dentro ci sono i documenti datati fino all'ultimo
-- giorno del mese che non sono ancora finiti in un file precedente. Per saperlo
-- serve un registro: una riga per documento consegnato, con il file (mese) in
-- cui è partito, chi l'ha mandato e quando.
--
-- Il registro dice SOLO «consegnato allo studio». Non porta negozio, centro di
-- costo o riparto: le suddivisioni del gestionale restano quelle delle regole di
-- riparto (supplier_allocation_rules) e si fanno dopo, sui costi a magazzino.
--
-- Punto di partenza (solo New Zago, riempito a parte, non da questa migrazione):
-- il file di settembre 2026 mandato da Sabrina (export Fattura SMART), 185 fatture.
-- Da ottobre 2026 il file lo produce il gestionale e aggiunge qui le sue righe.
--
-- Additiva, nessun dato toccato. Vale su ogni tenant (tabella vuota su Made e Zago).
-- Rollback: 20261015_308_registro_fatture_acquisto_inviate_ROLLBACK.sql

CREATE TABLE IF NOT EXISTS public.purchase_invoice_dispatches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  electronic_invoice_id uuid REFERENCES public.electronic_invoices(id) ON DELETE SET NULL,
  -- Dati del documento come risultano nel file consegnato (restano anche se la
  -- fattura elettronica non è nel gestionale o viene ricaricata).
  supplier_vat          text,
  supplier_name         text,
  invoice_number        text NOT NULL,
  invoice_date          date,
  document_type         text,
  net_amount            numeric(14,2),
  total_amount          numeric(14,2),
  -- Mese del file in cui il documento è stato consegnato (primo giorno del mese).
  file_period           date NOT NULL CHECK (file_period = date_trunc('month', file_period)::date),
  sent_by               text NOT NULL CHECK (sent_by IN ('manuale_studio', 'gestionale')),
  sent_at               timestamptz,
  source_file           text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.purchase_invoice_dispatches IS
  'Registro delle fatture acquisto già consegnate allo studio nel file mensile «Fatture acquisto»: un documento compare in un solo file. Nessun negozio o centro di costo: le suddivisioni restano alle regole di riparto. Migrazione 308.';

-- Un documento si consegna una volta sola.
CREATE UNIQUE INDEX IF NOT EXISTS purchase_invoice_dispatches_one_per_invoice
  ON public.purchase_invoice_dispatches (company_id, electronic_invoice_id)
  WHERE electronic_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_invoice_dispatches_one_per_document
  ON public.purchase_invoice_dispatches (company_id, supplier_vat, invoice_number, invoice_date);
CREATE INDEX IF NOT EXISTS purchase_invoice_dispatches_period
  ON public.purchase_invoice_dispatches (company_id, file_period);

ALTER TABLE public.purchase_invoice_dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation_select ON public.purchase_invoice_dispatches FOR SELECT
  USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY company_isolation_insert ON public.purchase_invoice_dispatches FOR INSERT
  WITH CHECK (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY company_isolation_update ON public.purchase_invoice_dispatches FOR UPDATE
  USING (company_id = (SELECT public.get_my_company_id()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()));
