-- Rollback 20260908_200: torna alla regola precedente (solo super_advisor o righe in user_outlet_access).
CREATE OR REPLACE FUNCTION public.has_outlet_access(p_outlet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up WHERE up.id = auth.uid()
      AND (up.role = 'super_advisor' OR EXISTS (
        SELECT 1 FROM user_outlet_access uoa WHERE uoa.user_id = auth.uid() AND uoa.outlet_id = p_outlet_id
      ))
  );
$$;
