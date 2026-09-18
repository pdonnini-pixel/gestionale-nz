-- ROLLBACK di 20260918_240_viewer_readonly_blocco_scritture.sql
-- Rimuove le policy restrittive che tengono il viewer fuori dalle scritture.
-- Dopo questo script il ruolo 'viewer' torna a poter scrivere sulle tabelle
-- con policy permissive FOR ALL che guardano solo l'azienda: eseguirlo solo
-- se il blocco rompe qualcosa.

BEGIN;

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT DISTINCT tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname IN ('viewer_no_insert','viewer_no_update','viewer_no_delete')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS viewer_no_insert ON public.%I', t.tablename);
    EXECUTE format('DROP POLICY IF EXISTS viewer_no_update ON public.%I', t.tablename);
    EXECUTE format('DROP POLICY IF EXISTS viewer_no_delete ON public.%I', t.tablename);
  END LOOP;
END $$;

COMMIT;
