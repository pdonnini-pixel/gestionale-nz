-- Rollback della 414: torna al vincolo e alla policy della 413.
-- Attenzione: con il CASCADE la traccia degli invii torna a sparire se qualcuno
-- cancella il documento dall'archivio, e la scrittura torna aperta a ogni ruolo
-- della stessa azienda.
BEGIN;

ALTER TABLE public.prima_nota_invii
  DROP CONSTRAINT IF EXISTS prima_nota_invii_document_id_fkey;
ALTER TABLE public.prima_nota_invii
  ADD CONSTRAINT prima_nota_invii_document_id_fkey
  FOREIGN KEY (document_id) REFERENCES public.import_documents(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS prima_nota_invii_write ON public.prima_nota_invii;
CREATE POLICY prima_nota_invii_write ON public.prima_nota_invii FOR ALL TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()));

COMMIT;
