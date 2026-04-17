-- ============================================================
-- Fase 2.2 — RPC function per leggere credenziali Yapily dal Vault
-- SECURITY DEFINER: esegue con i privilegi del proprietario (postgres)
-- Applicata su Supabase: 2026-04-17
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_yapily_credentials()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uuid TEXT;
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO v_uuid
  FROM vault.decrypted_secrets
  WHERE name = 'yapily_application_uuid';

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'yapily_application_secret';

  IF v_uuid IS NULL OR v_secret IS NULL THEN
    RAISE EXCEPTION 'Yapily credentials not found in Vault';
  END IF;

  RETURN json_build_object('uuid', v_uuid, 'secret', v_secret);
END;
$$;

-- Solo utenti autenticati possono chiamare questa funzione
REVOKE ALL ON FUNCTION public.get_yapily_credentials() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_yapily_credentials() TO authenticated;
