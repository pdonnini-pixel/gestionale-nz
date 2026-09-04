-- @no-transaction
-- =====================================================================
-- Migrazione 172 — Ruolo 'operatore_cassa' (account di negozio)
-- =====================================================================
-- COSA MANCAVA: non esisteva un ruolo per chi sta in cassa. Il menu di
-- Impostazioni offriva "store_manager" e "operatrice", ma nessuno dei due
-- era nell'enum user_role: l'invito creava il login e poi falliva sul
-- profilo (`invalid input value for enum user_role`).
--
-- COSA INTRODUCE:
--   1. Il valore enum 'operatore_cassa': un account per outlet, condiviso
--      dal personale del negozio, che compila la chiusura di cassa serale
--      (vedi migrazione 173) e non deve vedere nient'altro.
--   2. Una policy RESTRITTIVA "cash_operator_block" su ogni tabella public
--      con RLS che NON sta nella lista bianca qui sotto. Le policy
--      restrittive si sommano in AND a quelle esistenti: per tutti gli altri
--      ruoli non cambia nulla, per l'operatore di cassa le tabelle sensibili
--      (fornitori, banche, fatture, budget, personale...) restano invisibili
--      anche interrogando l'API direttamente con il proprio token.
--      Le SELECT filtrate da RLS restituiscono zero righe (non errori), quindi
--      i componenti condivisi del layout non si rompono.
--
-- LISTA BIANCA (tabelle che l'operatore di cassa puo' raggiungere, con le
-- policy ordinarie di quelle tabelle): companies, company_settings,
-- user_profiles, user_outlet_access, outlets, help_chat_sessions,
-- help_chat_messages, outlet_payment_channels, outlet_daily_closings,
-- outlet_daily_closing_lines, outlet_daily_closing_attachments.
--
-- NOTA: le tabelle create in futuro NON ricevono la policy in automatico.
-- Chi crea una tabella sensibile deve aggiungerla (stesso CREATE POLICY qui
-- sotto) oppure rilanciare il blocco DO di questa migrazione.
--
-- ALTER TYPE ... ADD VALUE non puo' stare in una transazione esplicita:
-- il file e' marcato @no-transaction. Il blocco DO confronta il ruolo come
-- ::text, cosi' non dipende dal nuovo valore enum gia' committato. Il COALESCE
-- evita di bloccare un utente senza profilo (ruolo NULL): per lui nulla cambia.
--
-- NO DATA LOSS: solo enum + policy, nessun dato toccato.
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago (3 project_id).
-- =====================================================================

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'operatore_cassa';

DO $$
DECLARE
  t record;
  allow text[] := ARRAY[
    'companies', 'company_settings', 'user_profiles', 'user_outlet_access',
    'outlets', 'help_chat_sessions', 'help_chat_messages',
    'outlet_payment_channels', 'outlet_daily_closings',
    'outlet_daily_closing_lines', 'outlet_daily_closing_attachments'
  ];
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity
      AND tablename <> ALL (allow)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS cash_operator_block ON public.%I', t.tablename);
    EXECUTE format(
      'CREATE POLICY cash_operator_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (COALESCE(public.get_my_role()::text, '''') <> ''operatore_cassa'') '
      || 'WITH CHECK (COALESCE(public.get_my_role()::text, '''') <> ''operatore_cassa'')',
      t.tablename);
  END LOOP;
END $$;

-- Verifica (attesi: 1 riga per 'operatore_cassa' e >100 policy restrittive):
--   SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--    WHERE t.typname = 'user_role' AND enumlabel = 'operatore_cassa';
--   SELECT count(*) FROM pg_policies WHERE policyname = 'cash_operator_block';
