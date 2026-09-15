-- Migrazione 109 — Protezione colonne privilegiate di user_profiles (role, company_id)
-- (audit sezione Ticket 2026-07-19, finding #1: "Escalation di privilegio: ogni
--  utente può auto-promuoversi a super_advisor").
--
-- Problema: la policy RLS "profiles_own_update" (baseline, riga 5707) permette a
-- ogni utente autenticato l'UPDATE dell'INTERA propria riga (USING id = auth.uid())
-- senza protezione di colonna: un PATCH via PostgREST con {"role":"super_advisor"}
-- promuove chiunque ad admin. Poiché get_my_role() legge da user_profiles ed è
-- usata dalle policy RLS di scrittura di tutta l'app (suppliers, yapily, ecc.) e
-- dal gate server-side della edge function ticket-resolve-now, l'escalation
-- bypassa l'intero RBAC, non solo la sezione Ticket.
--
-- Soluzione: trigger BEFORE UPDATE che blocca le modifiche a role/company_id se il
-- chiamante autenticato non è super_advisor. I contesti privilegiati — service
-- role (es. la edge function admin-manage-user, che è il percorso ufficiale per
-- cambiare i ruoli) e SQL editor del dashboard — hanno auth.uid() NULL e restano
-- consentiti. L'INSERT non serve proteggerlo: user_profiles non ha policy INSERT,
-- quindi è già negato ai client autenticati.
--
-- ⚠️ REGOLA #0 — PARITÀ TENANT: applicare su NZ + Made + Zago, identica.
-- CARATTERE: additivo/idempotente, nessun dato toccato.

BEGIN;

CREATE OR REPLACE FUNCTION public.protect_user_profiles_privileged_cols()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    -- auth.uid() IS NULL = contesto privilegiato (service role / dashboard SQL):
    -- consentito. Altrimenti solo un super_advisor può toccare role/company_id.
    IF auth.uid() IS NOT NULL
       AND COALESCE((SELECT role::text FROM public.user_profiles WHERE id = auth.uid()), '') <> 'super_advisor' THEN
      RAISE EXCEPTION 'Non autorizzato a modificare role o company_id del profilo'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_profiles_protect_privileged ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_protect_privileged
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_user_profiles_privileged_cols();

COMMIT;

-- Verifica post-applicazione (dal SQL editor, deve restituire il trigger):
--   SELECT tgname FROM pg_trigger
--   WHERE tgrelid = 'public.user_profiles'::regclass
--     AND tgname = 'trg_user_profiles_protect_privileged';
--
-- Test funzionale (come utente NON super_advisor, es. dalla console del browser
-- loggati come contabile — deve fallire con "Non autorizzato"):
--   await supabase.from('user_profiles').update({ role: 'super_advisor' }).eq('id', (await supabase.auth.getUser()).data.user.id)
--
-- Rollback (se servisse tornare indietro):
--   DROP TRIGGER IF EXISTS trg_user_profiles_protect_privileged ON public.user_profiles;
--   DROP FUNCTION IF EXISTS public.protect_user_profiles_privileged_cols();
