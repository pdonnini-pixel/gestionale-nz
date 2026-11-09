-- =====================================================================
-- Migrazione 370 — Il dipendente dell'app legge solo il suo profilo
-- =====================================================================
-- PERCHE': controllo di sicurezza del 08/11/2026 prima della revisione
-- degli store. Il ruolo «dipendente» (app New Zago) era bloccato su tutte
-- le tabelle (dipendente_block, migration 246b e seguenti) tranne sette,
-- lasciate leggibili all'inizio: dati societari (companies,
-- company_settings), negozi (outlets), permessi sui negozi
-- (user_outlet_access), profili degli utenti del gestionale (nomi ed
-- email, user_profiles) e chat d'aiuto. L'app non le usa: legge tutto con
-- le funzioni app_*. Con l'account di prova dato ad Apple e Google le
-- avrebbero lette anche persone esterne.
--
-- COSA FA: policy RESTRICTIVE «dipendente_block» (stessa formula delle
-- altre tabelle) su sei tabelle; su user_profiles il dipendente legge e
-- aggiorna solo la propria riga (serve al login: useAuth.fetchProfile).
-- Gli altri ruoli non cambiano.
-- NO DATA LOSS: solo policy. Tenant: NZ e Zago.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies', 'company_settings', 'outlets', 'user_outlet_access',
    'help_chat_messages', 'help_chat_sessions'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'dipendente_block') THEN
      EXECUTE format(
        'CREATE POLICY dipendente_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
           USING (COALESCE(((SELECT public.get_my_role()))::text, '''') <> ''dipendente'')
           WITH CHECK (COALESCE(((SELECT public.get_my_role()))::text, '''') <> ''dipendente'')', t);
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_profiles' AND policyname = 'dipendente_solo_suo') THEN
    CREATE POLICY dipendente_solo_suo ON public.user_profiles AS RESTRICTIVE FOR ALL TO authenticated
      USING (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'dipendente' OR id = (SELECT auth.uid()))
      WITH CHECK (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'dipendente' OR id = (SELECT auth.uid()));
  END IF;
END;
$$;

COMMIT;

-- Verifica, su ogni tenant:
-- SELECT tablename, policyname FROM pg_policies
--  WHERE policyname IN ('dipendente_block', 'dipendente_solo_suo')
--    AND tablename IN ('companies','company_settings','outlets','user_outlet_access','help_chat_messages','help_chat_sessions','user_profiles');
--  -- 7 righe
