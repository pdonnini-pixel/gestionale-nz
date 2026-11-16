-- 412 — Scheda «Documenti» del negozio: abbinamento a mano di un file dell'archivio
--       a un documento del contratto (disegno approvato da Patrizio il 16/11/2026).
--
-- La scheda mostra come un elenco solo due cose che nel database restano separate:
--   - le righe del contratto (public.outlet_attachments), ognuna con la copia «che vale»;
--   - i file dell'archivio (public.documents con reference_type = 'outlet', public.contract_documents).
-- Un file dell'archivio si abbina a una riga riconoscendolo dal nome (src/lib/documentiNegozio.ts):
-- quell'abbinamento si CALCOLA a video e non si scrive da nessuna parte.
-- Questa tabella tiene solo le scelte fatte a mano da una persona («Sposta in…»):
--   attachment_id = riga del contratto scelta, oppure NULL = «lascialo fra gli altri documenti».
-- La scelta a mano vince sul riconoscimento. Nessun riempimento in massa: la tabella nasce vuota.
--
-- NO DATA LOSS: niente si sposta e niente si cancella. È un collegamento in più; i file restano
-- nelle loro tabelle. Togliere una riga da qui riporta il file dove lo mette il riconoscimento.
--
-- Permessi come public.outlet_attachments e public.documents (policy lette sul database vivo il
-- 16/11/2026): legge chi è dell'azienda, scrivono super_advisor e contabile; chiusi operatore di
-- cassa, dipendente, responsabile di negozio, chi non ha un profilo; il viewer non scrive.
--
-- Tenant: NZ e Zago. Dove la tabella manca il frontend usa il solo riconoscimento dal nome.
-- Rollback: 20261116_412_outlet_document_links_ROLLBACK.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.outlet_document_links (
  document_table text NOT NULL,
  document_id    uuid NOT NULL,
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  outlet_id      uuid NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  attachment_id  uuid REFERENCES public.outlet_attachments(id) ON DELETE CASCADE,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid DEFAULT auth.uid(),
  CONSTRAINT outlet_document_links_pkey PRIMARY KEY (document_table, document_id),
  CONSTRAINT outlet_document_links_tabella CHECK (document_table IN ('documents', 'contract_documents'))
);
COMMENT ON TABLE public.outlet_document_links IS
  'Scheda Documenti del negozio: abbinamento deciso a mano fra un file dell''archivio e una riga del contratto (attachment_id NULL = fra gli altri documenti). Vince sul riconoscimento dal nome. Migration 412.';

CREATE INDEX IF NOT EXISTS outlet_document_links_outlet_idx ON public.outlet_document_links (outlet_id);
CREATE INDEX IF NOT EXISTS outlet_document_links_company_idx ON public.outlet_document_links (company_id);
CREATE INDEX IF NOT EXISTS outlet_document_links_attachment_idx ON public.outlet_document_links (attachment_id);

-- La riga del contratto scelta deve essere dello stesso negozio e della stessa azienda, e anche il
-- file collegato: un file dell'archivio di un altro negozio non si aggancia qui (revisione del 16/11/2026).
-- La funzione gira con i permessi di chi scrive: un file che la RLS non gli fa vedere non si collega.
CREATE OR REPLACE FUNCTION public.outlet_document_links_coerente() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.outlets o WHERE o.id = NEW.outlet_id AND o.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Il negozio non è di questa azienda.' USING ERRCODE = '23514';
  END IF;
  IF NEW.attachment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.outlet_attachments a
    WHERE a.id = NEW.attachment_id AND a.outlet_id = NEW.outlet_id AND a.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Il documento del contratto scelto non è di questo negozio.' USING ERRCODE = '23514';
  END IF;
  IF NEW.document_table = 'documents' AND NOT EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = NEW.document_id AND d.company_id = NEW.company_id
      AND d.reference_type = 'outlet' AND d.reference_id = NEW.outlet_id
  ) THEN
    RAISE EXCEPTION 'Il file non è fra i documenti di questo negozio.' USING ERRCODE = '23514';
  END IF;
  IF NEW.document_table = 'contract_documents' AND NOT EXISTS (
    SELECT 1 FROM public.contract_documents c
    WHERE c.id = NEW.document_id AND c.company_id = NEW.company_id AND c.outlet_id = NEW.outlet_id
  ) THEN
    RAISE EXCEPTION 'Il file non è fra i documenti di questo negozio.' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.outlet_document_links_coerente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_outlet_document_links_coerente ON public.outlet_document_links;
CREATE TRIGGER trg_outlet_document_links_coerente
  BEFORE INSERT OR UPDATE ON public.outlet_document_links
  FOR EACH ROW EXECUTE FUNCTION public.outlet_document_links_coerente();

ALTER TABLE public.outlet_document_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outlet_document_links_select ON public.outlet_document_links;
CREATE POLICY outlet_document_links_select ON public.outlet_document_links FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()));
DROP POLICY IF EXISTS outlet_document_links_write ON public.outlet_document_links;
CREATE POLICY outlet_document_links_write ON public.outlet_document_links FOR ALL TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND (SELECT public.get_my_role())::text IN ('super_advisor', 'contabile'))
  WITH CHECK (company_id = (SELECT public.get_my_company_id())
         AND (SELECT public.get_my_role())::text IN ('super_advisor', 'contabile'));
DROP POLICY IF EXISTS cash_operator_block ON public.outlet_document_links;
CREATE POLICY cash_operator_block ON public.outlet_document_links AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
DROP POLICY IF EXISTS dipendente_block ON public.outlet_document_links;
CREATE POLICY dipendente_block ON public.outlet_document_links AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');
DROP POLICY IF EXISTS responsabile_block ON public.outlet_document_links;
CREATE POLICY responsabile_block ON public.outlet_document_links AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile');
DROP POLICY IF EXISTS solo_con_profilo ON public.outlet_document_links;
CREATE POLICY solo_con_profilo ON public.outlet_document_links AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.get_my_role()) IS NOT NULL)
  WITH CHECK ((SELECT public.get_my_role()) IS NOT NULL);
DROP POLICY IF EXISTS viewer_no_insert ON public.outlet_document_links;
CREATE POLICY viewer_no_insert ON public.outlet_document_links AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'viewer');
DROP POLICY IF EXISTS viewer_no_update ON public.outlet_document_links;
CREATE POLICY viewer_no_update ON public.outlet_document_links AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'viewer')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'viewer');
DROP POLICY IF EXISTS viewer_no_delete ON public.outlet_document_links;
CREATE POLICY viewer_no_delete ON public.outlet_document_links AS RESTRICTIVE FOR DELETE TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'viewer');

REVOKE ALL ON public.outlet_document_links FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlet_document_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlet_document_links TO service_role;

COMMIT;

-- Verifica dopo l'applicazione (su ogni tenant):
--   SELECT has_table_privilege('authenticated','public.outlet_document_links','select') AS auth,
--          has_table_privilege('service_role','public.outlet_document_links','insert') AS srv,
--          has_table_privilege('anon','public.outlet_document_links','select') AS anon,   -- false
--          (SELECT count(*) FROM pg_policies WHERE tablename = 'outlet_document_links') AS policy,  -- 9
--          (SELECT count(*) FROM public.outlet_document_links) AS righe;                   -- 0
