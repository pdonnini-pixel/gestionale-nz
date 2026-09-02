-- =====================================================================
-- Migrazione 155 — Chat assistente AI: sessioni tracciate e archiviate
-- =====================================================================
-- COSA MANCAVA: la tab "Chiedi all'AI" del pannello di aiuto (HelpPanel)
-- teneva la conversazione SOLO nello stato React. Cambiando pagina, chiudendo
-- il pannello o ricaricando il browser, domande e risposte sparivano per
-- sempre: nessuno storico, nessun modo di risalire a cosa era stato chiesto.
--
-- COSA INTRODUCE:
--   * help_chat_sessions  — una riga per conversazione, con stato
--     'aperta' / 'chiusa'. La chat resta APERTA finche' e' l'operatrice a
--     dichiararla chiusa (pulsante "Chiudi chat"): nessuna chiusura
--     automatica per cambio pagina, logout o scadenza.
--   * help_chat_messages  — le battute (domande e risposte) in ordine,
--     immutabili: si inseriscono e basta (nessun UPDATE/DELETE da RLS),
--     cosi' l'archivio resta fedele a quello che e' stato detto.
--
-- UNA SOLA CHAT APERTA PER SEZIONE: indice unico parziale su
-- (company_id, user_id, page_path) WHERE status='aperta'. Tornando su una
-- sezione si riprende la stessa conversazione; quando la si chiude, la
-- domanda successiva ne apre una nuova.
--
-- VISIBILITA' (scelta di Patrizio, 2026-09-02): l'archivio e' condiviso a
-- livello azienda — chiunque nel tenant LEGGE tutte le chat (base di
-- conoscenza comune). SCRIVE solo l'autore, e solo nella propria chat
-- ancora aperta; puo' chiuderla l'autore o il super_advisor.
--
-- NOTA RUOLO viewer: la scrittura NON e' gated per ruolo come sulle tabelle
-- di dati. Anche un viewer (sola lettura sui dati aziendali) puo' fare le
-- proprie domande all'assistente: qui non si scrivono dati contabili, solo
-- la propria conversazione di supporto.
--
-- NO DATA LOSS: migrazione puramente additiva (2 CREATE TABLE + indici +
-- policy). Nessuna tabella esistente viene toccata.
--
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago (3 project_id).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Sessioni (una per conversazione)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.help_chat_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id),
  -- auth.uid() dell'autore. Nessuna FK ad auth.users di proposito: la
  -- cancellazione di un utente non deve portarsi via l'archivio (NO DATA LOSS).
  user_id         uuid NOT NULL,
  -- Nome leggibile denormalizzato (come tickets.autore): l'elenco archivio
  -- non deve dipendere da un join a user_profiles.
  user_name       text,
  -- Sezione da cui e' partita la chat: rotta canonica ("/scadenzario").
  page_path       text NOT NULL,
  page_title      text,
  -- Titolo della chat = prima domanda troncata (valorizzato dal trigger).
  title           text,
  status          text NOT NULL DEFAULT 'aperta' CHECK (status IN ('aperta', 'chiusa')),
  message_count   integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  closed_by       uuid
);

COMMENT ON TABLE public.help_chat_sessions IS
  'Conversazioni con l''assistente AI (HelpPanel). Restano ''aperta'' finche'' l''operatrice non le chiude a mano.';

-- Una sola chat aperta per utente e sezione.
CREATE UNIQUE INDEX IF NOT EXISTS help_chat_sessions_one_open_per_page
  ON public.help_chat_sessions (company_id, user_id, page_path)
  WHERE status = 'aperta';

-- Elenco archivio: aperte prima, poi per ultima attivita'.
CREATE INDEX IF NOT EXISTS help_chat_sessions_company_activity
  ON public.help_chat_sessions (company_id, status, last_message_at DESC NULLS LAST);

-- ---------------------------------------------------------------------
-- 2. Messaggi (domande e risposte, immutabili)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.help_chat_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.help_chat_sessions(id) ON DELETE CASCADE,
  -- Ridondante ma indispensabile: la RLS filtra per azienda senza join.
  company_id uuid NOT NULL REFERENCES public.companies(id),
  role       text NOT NULL CHECK (role IN ('user', 'assistant')),
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.help_chat_messages IS
  'Battute delle chat AI: sola INSERT (archivio fedele, nessun UPDATE/DELETE da RLS).';

CREATE INDEX IF NOT EXISTS help_chat_messages_session_order
  ON public.help_chat_messages (session_id, created_at);

-- ---------------------------------------------------------------------
-- 3. Trigger: contatori, ultima attivita' e titolo della chat
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_help_chat_touch_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.help_chat_sessions s
     SET message_count   = s.message_count + 1,
         last_message_at = NEW.created_at,
         updated_at      = now(),
         -- Il titolo e' la prima domanda dell'operatrice, troncata.
         title           = COALESCE(
                             s.title,
                             CASE WHEN NEW.role = 'user'
                                  THEN left(regexp_replace(NEW.content, '\s+', ' ', 'g'), 120)
                             END)
   WHERE s.id = NEW.session_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_help_chat_touch_session ON public.help_chat_messages;
CREATE TRIGGER trg_help_chat_touch_session
  AFTER INSERT ON public.help_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_help_chat_touch_session();

-- ---------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------
ALTER TABLE public.help_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_chat_messages ENABLE ROW LEVEL SECURITY;

-- Lettura: tutta l'azienda (archivio condiviso).
DROP POLICY IF EXISTS help_chat_sessions_select ON public.help_chat_sessions;
CREATE POLICY help_chat_sessions_select ON public.help_chat_sessions
  FOR SELECT USING (company_id = get_my_company_id());

-- Creazione: solo per se stessi, nella propria azienda.
DROP POLICY IF EXISTS help_chat_sessions_insert ON public.help_chat_sessions;
CREATE POLICY help_chat_sessions_insert ON public.help_chat_sessions
  FOR INSERT WITH CHECK (company_id = get_my_company_id() AND user_id = auth.uid());

-- Aggiornamento (in pratica: chiusura della chat): l'autore o il super_advisor.
DROP POLICY IF EXISTS help_chat_sessions_update ON public.help_chat_sessions;
CREATE POLICY help_chat_sessions_update ON public.help_chat_sessions
  FOR UPDATE
  USING (company_id = get_my_company_id()
         AND (user_id = auth.uid() OR get_my_role() = 'super_advisor'::user_role))
  WITH CHECK (company_id = get_my_company_id());

-- Nessuna policy DELETE: le chat non si cancellano (NO DATA LOSS).

DROP POLICY IF EXISTS help_chat_messages_select ON public.help_chat_messages;
CREATE POLICY help_chat_messages_select ON public.help_chat_messages
  FOR SELECT USING (company_id = get_my_company_id());

-- Si scrive solo nella PROPRIA chat e solo finche' e' aperta: dopo la
-- chiusura l'archivio e' congelato.
DROP POLICY IF EXISTS help_chat_messages_insert ON public.help_chat_messages;
CREATE POLICY help_chat_messages_insert ON public.help_chat_messages
  FOR INSERT WITH CHECK (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM public.help_chat_sessions s
       WHERE s.id = help_chat_messages.session_id
         AND s.company_id = get_my_company_id()
         AND s.user_id = auth.uid()
         AND s.status = 'aperta'
    )
  );

-- ---------------------------------------------------------------------
-- 5. Grant espliciti (anon fuori, come da migrazioni 116/154)
-- ---------------------------------------------------------------------
REVOKE ALL ON public.help_chat_sessions FROM PUBLIC, anon;
REVOKE ALL ON public.help_chat_messages FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.help_chat_sessions TO authenticated;
GRANT SELECT, INSERT ON public.help_chat_messages TO authenticated;
GRANT ALL ON public.help_chat_sessions TO service_role;
GRANT ALL ON public.help_chat_messages TO service_role;

REVOKE ALL ON FUNCTION public.fn_help_chat_touch_session() FROM PUBLIC, anon;

COMMIT;

-- =====================================================================
-- VERIFICA (attesa: 2 tabelle con rowsecurity=true, 5 policy, 1 trigger)
-- =====================================================================
-- SELECT tablename, rowsecurity FROM pg_tables
--  WHERE schemaname='public' AND tablename LIKE 'help_chat_%';
--
-- SELECT tablename, policyname, cmd FROM pg_policies
--  WHERE schemaname='public' AND tablename LIKE 'help_chat_%' ORDER BY 1,2;
--
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.help_chat_messages'::regclass
--   AND NOT tgisinternal;
