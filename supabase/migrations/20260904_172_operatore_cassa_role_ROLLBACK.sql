-- ROLLBACK migrazione 172 — ruolo operatore_cassa
--
-- Il valore enum NON si puo' rimuovere in PostgreSQL senza ricreare il tipo:
-- resta, inoffensivo, se nessun profilo lo usa. Qui si tolgono solo le
-- policy restrittive. Nessun dato coinvolto.

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'cash_operator_block'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS cash_operator_block ON public.%I', t.tablename);
  END LOOP;
END $$;
