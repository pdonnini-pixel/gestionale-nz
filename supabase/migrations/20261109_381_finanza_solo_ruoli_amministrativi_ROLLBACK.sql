-- Rollback della migration 381: torna la lista nera della 380 e i permessi
-- di prima su daily_report_outlets / daily_report_is_complete.
BEGIN;

CREATE OR REPLACE FUNCTION public.ruoli_operativi_non_qui()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF COALESCE(auth.role(), '') = 'authenticated'
     AND pg_trigger_depth() = 0
     AND COALESCE((SELECT public.get_my_role())::text, '') IN ('operatore_cassa', 'dipendente') THEN
    RAISE EXCEPTION 'Non disponibile con questo profilo' USING ERRCODE = '42501';
  END IF;
END;
$$;
COMMENT ON FUNCTION public.ruoli_operativi_non_qui() IS NULL;
REVOKE ALL ON FUNCTION public.ruoli_operativi_non_qui() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ruoli_operativi_non_qui() TO service_role;

GRANT EXECUTE ON FUNCTION public.daily_report_outlets(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.daily_report_is_complete(uuid, date) TO anon, authenticated, service_role;

COMMIT;
