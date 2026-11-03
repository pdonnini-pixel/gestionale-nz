-- 338 — Indirizzo in copia per le email di un account (Patrizio, 03/11/2026)
--
-- «Mettimi in copia newzago@vicolo.com a ogni mail che parte verso
-- roma@outletvicolo.com.» Gli account di negozio hanno caselle che spesso
-- nessuno legge: chi li segue (l'amministrazione) deve ricevere le stesse
-- email. Nessun indirizzo nel codice: si scrive sul profilo dell'account, da
-- Impostazioni → Utenti, e lo usano tutte le funzioni che scrivono a quella
-- persona (admin-manage-user: invito, reinvio, password dimenticata;
-- ticket-notify-resolved: segnalazione risolta).
-- Solo aggiunta: nessuna riga cambia.

BEGIN;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS email_cc text;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_email_cc_formato;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_email_cc_formato
  CHECK (email_cc IS NULL OR email_cc ~* '^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}$');

COMMENT ON COLUMN public.user_profiles.email_cc IS
  'Indirizzo messo in copia a ogni email che il gestionale manda a questo account (03/11/2026). Si imposta da Impostazioni → Utenti.';

-- Chi riceve la copia riceve anche i link di accesso: la sceglie solo un
-- super_advisor (dalla funzione admin-manage-user, che usa il service role).
-- La policy profiles_own_update lascia a ognuno la propria riga, quindi la
-- colonna entra nello stesso controllo di role e company_id.
CREATE OR REPLACE FUNCTION public.protect_user_profiles_privileged_cols()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.email_cc IS DISTINCT FROM OLD.email_cc THEN
    IF auth.uid() IS NOT NULL
       AND COALESCE((SELECT role::text FROM public.user_profiles WHERE id = auth.uid()), '') <> 'super_advisor' THEN
      RAISE EXCEPTION 'Non autorizzato a modificare role, company_id o email_cc del profilo'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;
