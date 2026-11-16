-- ROLLBACK della 412 — toglie l'abbinamento a mano dei file ai documenti del contratto.
--
-- Nessun file e nessun documento si perde: la tabella tiene solo i collegamenti scelti a mano.
-- Prima di toglierla le scelte si copiano in una tabella di backup senza permessi per l'API,
-- così si possono rimettere:
--   INSERT INTO public.outlet_document_links SELECT * FROM public._bkp_412_outlet_document_links;
-- Dopo il rollback la scheda torna al solo riconoscimento dal nome (il frontend lo regge).

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.outlet_document_links') IS NOT NULL THEN
    CREATE TABLE IF NOT EXISTS public._bkp_412_outlet_document_links AS
      SELECT * FROM public.outlet_document_links WITH NO DATA;
    INSERT INTO public._bkp_412_outlet_document_links
      SELECT l.* FROM public.outlet_document_links l
      WHERE NOT EXISTS (SELECT 1 FROM public._bkp_412_outlet_document_links b
                        WHERE b.document_table = l.document_table AND b.document_id = l.document_id);
    ALTER TABLE public._bkp_412_outlet_document_links ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public._bkp_412_outlet_document_links FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

DROP TABLE IF EXISTS public.outlet_document_links;
DROP FUNCTION IF EXISTS public.outlet_document_links_coerente();

COMMIT;
