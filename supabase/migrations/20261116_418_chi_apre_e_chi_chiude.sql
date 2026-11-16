-- 418 — Chi puo' aprire e chi puo' chiudere il negozio (Patrizio, 16/11/2026)
--
-- «Non e' un obbligo, e' un'abilitazione»: una persona appena assunta non ha le chiavi e non sa
-- ancora come si chiude. Due spunte sulla scheda della dipendente:
--   puo_aprire, puo_chiudere: true = abilitata, false = non abilitata, NULL = da indicare.
-- Chi esiste oggi resta NULL (da indicare); chi viene assunto da qui in poi parte da false.
-- Il motore dei turni applica la regola in un negozio solo quando nessuna persona in forza e'
-- «da indicare» e le abilitate sono almeno due per l'apertura e due per la chiusura
-- (responsabile e vice contano sempre come abilitate). Additiva: nessun dato cambia.
-- Solo New Zago e Zago (Made non si aggiorna piu'): il frontend funziona anche senza colonne.

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS puo_aprire boolean;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS puo_chiudere boolean;
-- solo per le righe nuove: le esistenti restano NULL («da indicare»)
ALTER TABLE public.employees ALTER COLUMN puo_aprire SET DEFAULT false;
ALTER TABLE public.employees ALTER COLUMN puo_chiudere SET DEFAULT false;

COMMENT ON COLUMN public.employees.puo_aprire IS
  'Abilitata ad aprire il negozio (ha le chiavi e sa come si fa). NULL = da indicare. Migration 418.';
COMMENT ON COLUMN public.employees.puo_chiudere IS
  'Abilitata a chiudere il negozio. NULL = da indicare. Migration 418.';

-- Chi scrive le spunte: l'HR dell'elenco (organico_e_hr), anche con un profilo che non scrive su
-- employees, oppure super_advisor e contabile; mai responsabile di negozio, dipendente, operatore
-- di cassa o chi non ha un profilo. La policy employees_write NON si allarga (darebbe all'HR la
-- scrittura su paghe e anagrafica): questa funzione tocca solo le due colonne, e se non puo' lo dice
-- invece di aggiornare zero righe in silenzio (revisore database, 16/11/2026).
CREATE OR REPLACE FUNCTION public.employee_chiavi_imposta(p_employee_id uuid, p_campo text, p_valore boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ruolo text := COALESCE((SELECT public.get_my_role())::text, '');
  v_azienda uuid := public.get_my_company_id();
BEGIN
  IF auth.uid() IS NULL OR v_azienda IS NULL OR v_ruolo IN ('', 'responsabile', 'dipendente', 'operatore_cassa') THEN
    RAISE EXCEPTION 'Non puoi cambiare chi apre e chi chiude il negozio.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.organico_e_hr() OR v_ruolo IN ('super_advisor', 'contabile')) THEN
    RAISE EXCEPTION 'Chi apre e chi chiude il negozio lo decide la responsabile HR.' USING ERRCODE = '42501';
  END IF;
  IF p_campo NOT IN ('puo_aprire', 'puo_chiudere') THEN
    RAISE EXCEPTION 'Scelta non valida.' USING ERRCODE = '22023';
  END IF;
  IF p_campo = 'puo_aprire' THEN
    UPDATE public.employees SET puo_aprire = p_valore WHERE id = p_employee_id AND company_id = v_azienda;
  ELSE
    UPDATE public.employees SET puo_chiudere = p_valore WHERE id = p_employee_id AND company_id = v_azienda;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dipendente non trovata in questa azienda.' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.employee_chiavi_imposta(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_chiavi_imposta(uuid, text, boolean) TO authenticated, service_role;
