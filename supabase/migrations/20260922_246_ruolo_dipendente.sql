-- @no-transaction
-- =====================================================================
-- Migrazione 246 — Ruolo 'dipendente' (accesso personale al piano ferie)
-- =====================================================================
-- PERCHE' ADESSO: il piano ferie porta dentro il gestionale una
-- settantina di persone che oggi non hanno nessun accesso. Si passa da 13
-- account a una settantina, e quasi tutti nuovi sono personale di negozio.
-- Il recinto va costruito PRIMA che esistano gli account, non dopo.
--
-- COSA INTRODUCE:
--   1. Il valore enum 'dipendente'.
--   2. Una policy RESTRITTIVA "dipendente_block" su ogni tabella public
--      con RLS che non sta nella lista bianca. Le policy restrittive si
--      sommano in AND: per tutti gli altri ruoli non cambia niente, per
--      il dipendente le tabelle aziendali restano invisibili anche
--      chiamando l'API REST direttamente con il proprio token.
--      Le SELECT filtrate da RLS tornano zero righe, non errori, quindi
--      i componenti condivisi del layout non si rompono.
--
-- LISTA BIANCA (tutto il resto e' chiuso):
--   companies, company_settings  -> l'azienda a cui appartiene
--   user_profiles                -> il proprio profilo e la rubrica interna
--   user_outlet_access, outlets  -> il proprio punto vendita
--                                   (outlets_select filtra gia' con
--                                    has_outlet_access: vede solo i suoi)
--   help_chat_sessions, help_chat_messages -> l'assistente
--
-- COSA NON E' NELLA LISTA, DI PROPOSITO: employees, leave_accrual_rows e
-- v_leave_balances. In fase 1 non esiste ancora nessuna interfaccia per
-- il dipendente, quindi il suo accesso e' chiuso su tutto cio' che
-- riguarda personale e retribuzioni. La fase 2, quando servira' fargli
-- vedere il PROPRIO saldo, aprira' quella strada con una policy che
-- filtra per la sua persona (employees.user_id), non aggiungendo la
-- tabella a questa lista: un dipendente non deve poter leggere i saldi,
-- i contratti e gli stipendi dei colleghi.
--
-- ATTENZIONE PER CHI VERRA' DOPO: le tabelle create in futuro NON
-- ricevono la policy in automatico. Chi crea una tabella sensibile la
-- aggiunge (stesso CREATE POLICY di qui sotto) oppure rilancia questo
-- blocco DO.
--
-- NO DATA LOSS: solo enum e policy, nessun dato toccato.
-- REGOLA #0: da applicare su NZ + Made + Zago.
-- Rollback: 20260922_246_ruolo_dipendente_ROLLBACK.sql
-- =====================================================================

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'dipendente';

DO $$
DECLARE
  t record;
  allow text[] := ARRAY[
    'companies', 'company_settings', 'user_profiles', 'user_outlet_access',
    'outlets', 'help_chat_sessions', 'help_chat_messages'
  ];
  n int := 0;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity
      AND tablename <> ALL (allow)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS dipendente_block ON public.%I', t.tablename);
    EXECUTE format(
      'CREATE POLICY dipendente_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (COALESCE(public.get_my_role()::text, '''') <> ''dipendente'') '
      || 'WITH CHECK (COALESCE(public.get_my_role()::text, '''') <> ''dipendente'')',
      t.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'dipendente_block creata su % tabelle', n;
END $$;

-- VERIFICA (attesi: 1 riga per 'dipendente' e >200 policy restrittive)
--   SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--    WHERE t.typname = 'user_role' AND enumlabel = 'dipendente';
--   SELECT count(*) FROM pg_policies WHERE policyname = 'dipendente_block';
--   -- le tabelle del piano ferie DEVONO essere bloccate:
--   SELECT tablename FROM pg_policies
--    WHERE policyname = 'dipendente_block' AND tablename LIKE 'leave_%';
