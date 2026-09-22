-- Rollback della migrazione 249 (ruolo 'dipendente').
--
-- Toglie le policy restrittive. Il VALORE dell'enum NON si puo' togliere
-- in PostgreSQL: resta, e non fa danno finche' nessun profilo lo usa.
-- Prima di eseguire, controllare che nessuno sia rimasto con quel ruolo:
--   SELECT id, email FROM public.user_profiles WHERE role::text = 'dipendente';
-- Se qualcuno c'e', va prima spostato su un altro ruolo, altrimenti
-- togliendo il blocco quell'account si ritrova a vedere tutto.

DO $$
DECLARE
  t record;
  n int := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE role::text = 'dipendente') THEN
    RAISE EXCEPTION 'Ci sono profili con ruolo dipendente: spostarli prima di togliere il blocco';
  END IF;
  FOR t IN
    SELECT tablename FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'dipendente_block'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS dipendente_block ON public.%I', t.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'dipendente_block rimossa da % tabelle', n;
END $$;
