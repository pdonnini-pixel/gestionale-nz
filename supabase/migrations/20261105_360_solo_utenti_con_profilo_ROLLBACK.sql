-- ROLLBACK della migrazione 360: toglie la policy restrittiva
-- «solo_con_profilo» da public e da storage.objects. Nessun dato toccato.
-- Da usare solo se un flusso legittimo con un account senza profilo
-- dovesse smettere di funzionare.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_policies
     WHERE schemaname = 'public' AND policyname = 'solo_con_profilo'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS solo_con_profilo ON public.%I', t.tablename);
  END LOOP;
END $$;

DROP POLICY IF EXISTS solo_con_profilo ON storage.objects;
