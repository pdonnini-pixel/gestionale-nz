-- =====================================================================
-- Migrazione 360 — Chi non ha un profilo nel gestionale non legge niente
-- =====================================================================
-- COSA NON ANDAVA (verifica del 05/11/2026 su NZ e Zago):
--   - Supabase Auth accetta registrazioni libere (disable_signup = false):
--     chiunque, con la chiave pubblica del sito, puo' creare un account,
--     confermare la propria mail ed entrare come «authenticated».
--   - Un account cosi' non ha una riga in user_profiles, quindi
--     get_my_role() e get_my_company_id() sono NULL. Le policy che guardano
--     l'azienda non gli danno niente, ma molte non la guardano:
--       * storage.objects: le policy dei bucket privati controllano solo
--         bucket_id. Simulando un account senza profilo su NZ: 1.203 file
--         visibili (fatture, estratti conto, bilanci, documenti dipendenti);
--       * acube_transactions, acube_sdi_invoices, acube_accounts,
--         acube_consents, acube_business_registries,
--         acube_sdi_business_registry_configs, acube_webhook_log,
--         acube_sdi_webhook_log, reconciliation_log: lettura con USING (true);
--       * tickets, supplier_opening_balances: tutto con USING (true).
--     I blocchi esistenti (cash_operator_block, dipendente_block, viewer_*)
--     non lo fermano: con il ruolo NULL la loro condizione e' vera.
--
-- COSA FA: una policy RESTRITTIVA «solo_con_profilo» per tutti i comandi,
-- per il ruolo authenticated: passa solo chi ha un profilo
-- ((SELECT get_my_role()) IS NOT NULL). Su:
--   - ogni tabella di public con la RLS attiva, tranne user_profiles
--     (chi non ha profilo li' non vede gia' niente, e la funzione di ruolo
--     legge proprio quella tabella);
--   - storage.objects.
-- Per chi ha un profilo (tutti gli utenti veri, compresi cassa, dipendente
-- e viewer) la condizione e' sempre vera: non cambia nulla. La service role
-- (Edge Function, cron) e anon non sono toccati.
-- Solo CREATE POLICY: nessun DROP, nessun dato toccato. Rilanciabile.
--
-- CHI USA UN ACCOUNT SENZA PROFILO (verifica del 05/11/2026): nessun flusso
-- dell'app. Gli utenti li crea admin-manage-user o app-dipendente-attiva,
-- sempre con il profilo; nel frontend non c'e' signUp; la timbratrice
-- (/timbra) entra con un account normale. Oggi senza profilo ci sono 1
-- account su NZ e 2 su Zago, tutti @newzago.it, residui di prove: dopo
-- questa migration non leggono piu' niente (non e' un dato perso).
--
-- DA FARE A PARTE (non e' SQL): spegnere la registrazione libera in
-- Supabase Auth su NZ e Zago. Questa policy e' la difesa anche se la
-- registrazione restasse aperta.
--
-- TABELLE NUOVE: la policy si mette sulle tabelle che esistono oggi. Chi
-- crea una tabella nuova con policy che non guardano l'azienda deve
-- aggiungere anche «solo_con_profilo» (stessa espressione).
--
-- PARITA' TENANT: dal 03/11/2026 NZ + Zago (niente Made).
-- =====================================================================

DO $$
DECLARE
  t record;
  n int := 0;
BEGIN
  FOR t IN
    SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relrowsecurity
       AND c.relname <> 'user_profiles'
       AND NOT EXISTS (SELECT 1 FROM pg_policies p
                        WHERE p.schemaname = 'public'
                          AND p.tablename = c.relname
                          AND p.policyname = 'solo_con_profilo')
  LOOP
    EXECUTE format(
      'CREATE POLICY solo_con_profilo ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING ((SELECT public.get_my_role()) IS NOT NULL) '
      || 'WITH CHECK ((SELECT public.get_my_role()) IS NOT NULL)',
      t.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'solo_con_profilo creata su % tabelle di public', n;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'solo_con_profilo') THEN
    CREATE POLICY solo_con_profilo ON storage.objects
      AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT public.get_my_role()) IS NOT NULL)
      WITH CHECK ((SELECT public.get_my_role()) IS NOT NULL);
  END IF;
END $$;

-- Verifica (attese: tutte le tabelle RLS di public tranne user_profiles,
-- piu' 1 su storage.objects; 0 tabelle RLS senza la policy):
--   SELECT schemaname, count(*) FROM pg_policies
--    WHERE policyname = 'solo_con_profilo' GROUP BY 1;
--   SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
--    WHERE ns.nspname = 'public' AND c.relkind IN ('r','p') AND c.relrowsecurity
--      AND c.relname <> 'user_profiles'
--      AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public'
--                      AND p.tablename = c.relname AND p.policyname = 'solo_con_profilo');
