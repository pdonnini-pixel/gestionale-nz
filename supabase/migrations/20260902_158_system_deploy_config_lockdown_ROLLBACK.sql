-- =====================================================================
-- ROLLBACK migrazione 158 — system_deploy_config
-- =====================================================================
-- ⚠️ RIAPRE LA FALLA: rimette la lettura del token GitHub in mano a
-- qualunque utente autenticato del tenant. Da usare solo se la revoca
-- rompesse qualcosa che gira senza service_role (non risulta esistere).
-- =====================================================================

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.system_deploy_config TO anon, authenticated;

CREATE POLICY system_deploy_config_authenticated_read
  ON public.system_deploy_config
  FOR SELECT
  TO authenticated
  USING (true);

COMMIT;
