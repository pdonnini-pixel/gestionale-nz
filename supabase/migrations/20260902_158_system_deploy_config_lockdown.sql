-- =====================================================================
-- Migrazione 158 — system_deploy_config non più leggibile dagli utenti
-- =====================================================================
-- IL PROBLEMA (verificato su NZ il 02/09/2026): la tabella
-- public.system_deploy_config contiene, nella chiave 'newzago_config_deploy',
-- un Personal Access Token GitHub con permessi di scrittura sul repo
-- gestionale-nz. La RLS era attiva, ma l'unica policy era:
--
--   system_deploy_config_authenticated_read  SELECT  {authenticated}  USING (true)
--
-- cioè QUALUNQUE utente autenticato del tenant poteva leggere il token
-- (Lilian, Massimo, Denise, domani Sabrina e Veronica). Il repo è unico per i
-- tre tenant, quindi quel token vale su tutto. In più anon e authenticated
-- avevano grant pieni (INSERT/UPDATE/DELETE/TRUNCATE) sulla tabella; anon in
-- lettura era salvo solo perché non esisteva una policy per lui — rete di
-- sicurezza sottile, dato che anon eredita anche i privilegi dati a PUBLIC.
--
-- PERCHE' SI PUO' TOGLIERE: nessun file del repo (src/, netlify/,
-- supabase/functions/, tools/) legge questa tabella, e nessuna funzione del DB
-- la nomina (verificato su pg_proc.prosrc). La usano solo edge function e task
-- che girano con service_role, che la RLS non la vede nemmeno e a cui i grant
-- restano intatti.
--
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago (3 project_id).
--
-- ⚠️ IL TOKEN VA CONSIDERATO BRUCIATO: è stato leggibile per mesi. La
-- rotazione NON è fatta qui: tocca anche i task schedulati e va fatta da
-- Patrizio in un momento scelto da lui.
--
-- NO DATA LOSS: nessun dato toccato, solo permessi.
-- =====================================================================

BEGIN;

-- 1. La policy che apriva la lettura a tutti gli autenticati
DROP POLICY IF EXISTS system_deploy_config_authenticated_read ON public.system_deploy_config;

-- 2. I grant di tabella. PUBLIC va revocato esplicitamente: anon eredita i
--    privilegi concessi a PUBLIC (è già successo su questo progetto).
REVOKE ALL ON TABLE public.system_deploy_config FROM PUBLIC;
REVOKE ALL ON TABLE public.system_deploy_config FROM anon;
REVOKE ALL ON TABLE public.system_deploy_config FROM authenticated;

-- 3. service_role continua a lavorare (edge function + task AutoFix).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.system_deploy_config TO service_role;

-- La RLS resta attiva: senza policy, nessun ruolo soggetto a RLS legge nulla.
ALTER TABLE public.system_deploy_config ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.system_deploy_config IS
  'Configurazione di deploy (contiene segreti). Accesso SOLO service_role: nessuna policy RLS per anon/authenticated — vedi migrazione 158.';

COMMIT;

-- =====================================================================
-- VERIFICA (da eseguire dopo, su ogni tenant)
-- =====================================================================
-- Policy rimaste (attese: nessuna):
--   SELECT polname FROM pg_policy WHERE polrelid='public.system_deploy_config'::regclass;
--
-- Grant rimasti (attesi: solo postgres e service_role):
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema='public' AND table_name='system_deploy_config';
--
-- Lettura come utente autenticato (attesa: 0 righe / permission denied):
--   SET LOCAL ROLE authenticated;
--   SELECT count(*) FROM public.system_deploy_config;
--   RESET ROLE;
--
-- Lettura come service_role (attesa: le righe ci sono ancora):
--   SET LOCAL ROLE service_role;
--   SELECT count(*) FROM public.system_deploy_config;
--   RESET ROLE;
-- =====================================================================
