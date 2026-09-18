-- 20260918_240_viewer_readonly_blocco_scritture.sql
--
-- Il ruolo 'viewer' (Sola lettura) era sola lettura solo nell'interfaccia:
-- banner in Layout.tsx, menu filtrato da VIEWER_ROUTES in Sidebar.tsx. Lato
-- database restava scrivibile, perche' 13 tabelle sensibili hanno policy
-- permissive FOR ALL che filtrano soltanto per azienda, senza guardare il
-- ruolo: bank_transactions, bank_statements, card_transactions,
-- payment_batches, payment_batch_items, riba_distinte, riba_distinta_lines,
-- manual_balance_entries, cash_must_pay, supplier_allocation_rules,
-- supplier_allocation_details, supplier_opening_balances, app_config.
-- Dal browser non ci si arriva (i pulsanti non sono renderizzati), ma una
-- chiamata diretta all'API REST con il JWT del viewer passava.
--
-- Qui il divieto si sposta dove conta: policy RESTRICTIVE su INSERT / UPDATE /
-- DELETE per ogni tabella public con RLS attiva. Stesso schema della
-- cash_operator_block (197 policy RESTRICTIVE che tengono l'operatore di cassa
-- fuori dalle tabelle aziendali): una policy restrittiva si somma alle altre,
-- quindi nessun permesso esistente viene allargato e la SELECT non e' toccata.
--
-- Whitelist (il viewer continua a poter scrivere, sono i suoi dati o il
-- supporto, non numeri aziendali):
--   tickets              -> aprire e aggiornare una segnalazione
--   help_chat_sessions   -> conversazione con l'assistente AI
--   help_chat_messages   -> messaggi di quella conversazione
--   notifications        -> segnare come letta la propria notifica
--   notification_preferences -> le proprie preferenze
--   user_profiles        -> il proprio profilo (nome, telefono)
-- La DELETE resta bloccata anche su queste: nessuna pagina del frontend
-- cancella righe di queste tabelle.
--
-- Additiva e ripetibile: DROP POLICY IF EXISTS prima di ogni CREATE, nessun
-- dato toccato, nessuna colonna modificata.
-- Rollback: 20260918_240_viewer_readonly_blocco_scritture_ROLLBACK.sql

BEGIN;

DO $$
DECLARE
  t record;
  -- Tabelle dove il viewer conserva INSERT e UPDATE.
  whitelist text[] := ARRAY[
    'tickets',
    'help_chat_sessions',
    'help_chat_messages',
    'notifications',
    'notification_preferences',
    'user_profiles'
  ];
  is_whitelisted boolean;
  n_tab int := 0;
BEGIN
  FOR t IN
    SELECT c.relname AS tabella
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity          -- solo tabelle con RLS attiva
    ORDER BY c.relname
  LOOP
    is_whitelisted := t.tabella = ANY(whitelist);

    -- DELETE: bloccata su tutte, whitelist compresa.
    EXECUTE format('DROP POLICY IF EXISTS viewer_no_delete ON public.%I', t.tabella);
    EXECUTE format($f$
      CREATE POLICY viewer_no_delete ON public.%I
        AS RESTRICTIVE FOR DELETE TO authenticated
        USING (COALESCE((public.get_my_role())::text, '') <> 'viewer')
    $f$, t.tabella);

    -- INSERT e UPDATE: bloccate tranne sulla whitelist.
    EXECUTE format('DROP POLICY IF EXISTS viewer_no_insert ON public.%I', t.tabella);
    EXECUTE format('DROP POLICY IF EXISTS viewer_no_update ON public.%I', t.tabella);

    IF NOT is_whitelisted THEN
      EXECUTE format($f$
        CREATE POLICY viewer_no_insert ON public.%I
          AS RESTRICTIVE FOR INSERT TO authenticated
          WITH CHECK (COALESCE((public.get_my_role())::text, '') <> 'viewer')
      $f$, t.tabella);

      -- USING impedisce di raggiungere la riga, WITH CHECK il valore nuovo.
      EXECUTE format($f$
        CREATE POLICY viewer_no_update ON public.%I
          AS RESTRICTIVE FOR UPDATE TO authenticated
          USING (COALESCE((public.get_my_role())::text, '') <> 'viewer')
          WITH CHECK (COALESCE((public.get_my_role())::text, '') <> 'viewer')
      $f$, t.tabella);
    END IF;

    n_tab := n_tab + 1;
  END LOOP;

  RAISE NOTICE 'viewer readonly: policy applicate su % tabelle', n_tab;
END $$;

COMMIT;

-- ── VERIFICA ──────────────────────────────────────────────────────────────
-- Tabelle coperte dal blocco (attese: tutte le public con RLS attiva):
--   SELECT count(DISTINCT tablename) FROM pg_policies
--   WHERE schemaname='public' AND policyname='viewer_no_delete';
--
-- Nessuna scrittura piu' aperta al viewer (atteso: 0 righe):
--   WITH w AS (
--     SELECT tablename, policyname, cmd,
--            coalesce(qual,'')||coalesce(with_check,'') AS expr,
--            array_to_string(roles,',') AS r
--     FROM pg_policies
--     WHERE schemaname='public' AND permissive='PERMISSIVE'
--       AND cmd IN ('ALL','INSERT','UPDATE','DELETE')
--   )
--   SELECT w.tablename, w.policyname, w.cmd FROM w
--   WHERE w.r <> 'service_role'
--     AND w.expr NOT LIKE '%super_advisor%'
--     AND w.expr NOT LIKE '%viewer%'
--     AND w.expr NOT LIKE '%budget_approver%'
--     AND w.expr NOT LIKE '%can_write_cash_closing%'
--     AND w.tablename NOT IN ('tickets','help_chat_sessions','help_chat_messages',
--                             'notifications','notification_preferences','user_profiles',
--                             'budget_approval_log')
--     AND NOT EXISTS (
--       SELECT 1 FROM pg_policies p
--       WHERE p.schemaname='public' AND p.tablename=w.tablename
--         AND p.policyname IN ('viewer_no_insert','viewer_no_update','viewer_no_delete')
--     );
