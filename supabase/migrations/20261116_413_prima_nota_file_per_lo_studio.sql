-- =====================================================================
-- 413 — Il file della Prima Nota resta in archivio, e si sa quando è andato allo studio
-- =====================================================================
-- Chiesto da Patrizio il 16/11/2026, dopo aver controllato il pacco di ottobre:
-- di diciannove file, diciotto erano archiviati e **l'unico mancante era proprio
-- il nostro**, l'Excel della Prima Nota. Si generava, si scaricava e finiva nella
-- cartella di chi lo spediva: a distanza di settimane non si poteva più dire che
-- cosa, esattamente, avesse in mano lo studio.
--
-- Da qui due cose, decise da lui:
--  1. a ogni export l'Excel va in archivio come ogni altro documento
--     (`import_documents`, bucket `general-documents`, modulo Banche): quello lo
--     fa il frontend, qui non serve niente;
--  2. serve sapere **quando** un file è stato mandato e **a chi**, e questo lo
--     dice una persona, non il sistema: le mail le manda Sabrina dal suo Gmail,
--     il gestionale non le vede. Perciò una riga la scrive chi conferma l'invio.
--
-- Questa migration fa solo il punto 2: la tabella degli invii.
--
-- PERCHÉ UNA TABELLA E NON UN CAMPO su `import_documents`: lo stesso file può
-- essere mandato due volte (allo studio e, più tardi, al commercialista che
-- chiede il mese di nuovo), e di ogni invio servono data e destinatario. Un campo
-- solo terrebbe l'ultimo e perderebbe il primo.
--
-- NO DATA LOSS: solo CREATE TABLE. Nessuna riga esistente toccata.
-- Tenant: NZ e Zago (Made non riceve più migration dal 03/11/2026).
--
-- NUMERO: applicata sui due tenant il 16/11/2026 quando il numero libero era il
-- 410; nel frattempo su main sono arrivate la 410 (distinta, mail vicolo.com) e
-- la 412, quindi il file porta il 413. In `supabase_migrations.schema_migrations`
-- di NZ e Zago la riga resta registrata con l'etichetta «20261116_410_prima_nota
-- _file_per_lo_studio»: è la stessa cosa, e cercarla per nome la trova.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.prima_nota_invii (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id),
  -- Il file mandato: è una riga dell'archivio unico dei documenti. Se il
  -- documento viene cancellato dall'archivio cade anche la traccia dell'invio,
  -- che da sola non direbbe più quale file era.
  document_id   uuid NOT NULL REFERENCES public.import_documents(id) ON DELETE CASCADE,
  -- Periodo a cui si riferisce il file (ottobre 2026), copiato dal documento:
  -- serve per trovare «cosa ha lo studio di ottobre» senza passare dal file.
  periodo_year  integer NOT NULL,
  periodo_month integer,
  inviato_il    date NOT NULL DEFAULT current_date,
  destinatario  text NOT NULL,
  note          text,
  registrato_da uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prima_nota_invii_mese_valido
    CHECK (periodo_month IS NULL OR periodo_month BETWEEN 1 AND 12),
  CONSTRAINT prima_nota_invii_anno_valido
    CHECK (periodo_year BETWEEN 2000 AND 2099),
  CONSTRAINT prima_nota_invii_destinatario_non_vuoto
    CHECK (length(btrim(destinatario)) > 0)
);

COMMENT ON TABLE public.prima_nota_invii IS
  'Invii del file della Prima Nota fuori dall''azienda (Patrizio, 16/11/2026): quale file archiviato, per quale periodo, quando e a chi. La riga la scrive una persona che conferma l''invio: le mail partono da Gmail e il gestionale non le vede, quindi qui non si deduce niente da solo.';
COMMENT ON COLUMN public.prima_nota_invii.destinatario IS
  'Chi ha ricevuto il file, in chiaro (studio, commercialista, banca). Testo libero: nessun nome e nessuna casella sono scritti nel codice, cambiano da azienda ad azienda.';

CREATE INDEX IF NOT EXISTS prima_nota_invii_periodo_idx
  ON public.prima_nota_invii (company_id, periodo_year, periodo_month DESC);
CREATE INDEX IF NOT EXISTS prima_nota_invii_document_idx
  ON public.prima_nota_invii (document_id);

ALTER TABLE public.prima_nota_invii ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prima_nota_invii_select ON public.prima_nota_invii;
CREATE POLICY prima_nota_invii_select ON public.prima_nota_invii FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()));
DROP POLICY IF EXISTS prima_nota_invii_write ON public.prima_nota_invii;
CREATE POLICY prima_nota_invii_write ON public.prima_nota_invii FOR ALL TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()));

-- Stessi recinti del resto della finanza: chi sta in cassa, in negozio o
-- nell'app dei dipendenti non vede né scrive la Prima Nota.
DROP POLICY IF EXISTS cash_operator_block ON public.prima_nota_invii;
CREATE POLICY cash_operator_block ON public.prima_nota_invii AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
DROP POLICY IF EXISTS dipendente_block ON public.prima_nota_invii;
CREATE POLICY dipendente_block ON public.prima_nota_invii AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');
DROP POLICY IF EXISTS responsabile_block ON public.prima_nota_invii;
CREATE POLICY responsabile_block ON public.prima_nota_invii AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile');
DROP POLICY IF EXISTS viewer_sola_lettura ON public.prima_nota_invii;
CREATE POLICY viewer_sola_lettura ON public.prima_nota_invii AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'viewer');
DROP POLICY IF EXISTS viewer_no_update ON public.prima_nota_invii;
CREATE POLICY viewer_no_update ON public.prima_nota_invii AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'viewer')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'viewer');
DROP POLICY IF EXISTS viewer_no_delete ON public.prima_nota_invii;
CREATE POLICY viewer_no_delete ON public.prima_nota_invii AS RESTRICTIVE FOR DELETE TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'viewer');
DROP POLICY IF EXISTS solo_con_profilo ON public.prima_nota_invii;
CREATE POLICY solo_con_profilo ON public.prima_nota_invii AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.get_my_role()) IS NOT NULL)
  WITH CHECK ((SELECT public.get_my_role()) IS NOT NULL);

-- Permessi espliciti (regola del 30/10/2026: le tabelle nuove non li ereditano).
REVOKE ALL ON public.prima_nota_invii FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prima_nota_invii TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prima_nota_invii TO service_role;

COMMIT;

-- =====================================================================
-- Verifica (su NZ e su Zago)
-- =====================================================================
--   SELECT has_table_privilege('authenticated','public.prima_nota_invii','select') AS auth,
--          has_table_privilege('service_role','public.prima_nota_invii','insert') AS srv,
--          has_table_privilege('anon','public.prima_nota_invii','select') AS anon_legge;
--   -- atteso: true, true, false
--
--   SELECT count(*) AS policy FROM pg_policies
--    WHERE schemaname='public' AND tablename='prima_nota_invii';
--   -- atteso: 9
-- =====================================================================
