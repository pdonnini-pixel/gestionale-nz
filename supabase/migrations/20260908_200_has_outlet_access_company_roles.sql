-- 20260908_200 — has_outlet_access: ruoli aziendali senza restrizioni vedono
-- tutti gli outlet della propria azienda.
--
-- Problema: un contabile (o ceo/cfo/coo/budget_approver/viewer) invitato da
-- Impostazioni → Utenti non ha righe in user_outlet_access, quindi la RLS di
-- outlets non gli mostrava nessun punto vendita e Incassi giornalieri restava
-- su «Caricamento…» (caso reale: Sabrina e Veronica, NZ, 8 settembre 2026).
--
-- Regola: super_advisor tutto (come prima); righe in user_outlet_access, se
-- presenti, restringono (come prima); ruoli diversi da operatore_cassa SENZA
-- righe → tutti gli outlet della propria azienda; operatore_cassa senza righe
-- → nessun outlet (come prima).
-- Applicata su NZ, Made e Zago.
CREATE OR REPLACE FUNCTION public.has_outlet_access(p_outlet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
      AND (
        up.role = 'super_advisor'
        OR EXISTS (
          SELECT 1 FROM user_outlet_access uoa
          WHERE uoa.user_id = auth.uid() AND uoa.outlet_id = p_outlet_id
        )
        OR (
          up.role <> 'operatore_cassa'
          AND NOT EXISTS (SELECT 1 FROM user_outlet_access uoa2 WHERE uoa2.user_id = auth.uid())
          AND EXISTS (SELECT 1 FROM outlets o WHERE o.id = p_outlet_id AND o.company_id = up.company_id)
        )
      )
  );
$$;
