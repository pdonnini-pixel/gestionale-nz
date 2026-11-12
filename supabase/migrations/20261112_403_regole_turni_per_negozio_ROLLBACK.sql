-- ROLLBACK della 403. Toglie colonne e una tabella nate con la 403: prima di eseguirlo
-- salvare quello che contengono e chiedere conferma a Patrizio (regola NO DATA LOSS):
--   SELECT outlet_id, riposi_min_settimana, straordinari_pari, caldi_tutti_al_lavoro, caldi_straordinari,
--          caldi_fasce_festivi, caldi_guida_apre_chiude, caldi_ore_apertura FROM public.outlet_shift_rules;
--   SELECT * FROM public.employee_riposi;
--   SELECT id, nome, tipo, regole, regole_origine, controllo_moda FROM public.outlet_events WHERE tipo IS NOT NULL;
-- Se la NZ_ONLY 404 e' stata applicata, va annullata prima (il suo rollback).
BEGIN;
ALTER TABLE public.outlet_events DROP CONSTRAINT IF EXISTS outlet_events_giorno_singolo_check;
ALTER TABLE public.outlet_events DROP CONSTRAINT IF EXISTS outlet_events_regole_forma_check;
ALTER TABLE public.outlet_events DROP CONSTRAINT IF EXISTS outlet_events_regole_origine_check;
ALTER TABLE public.outlet_events DROP CONSTRAINT IF EXISTS outlet_events_tipo_check;
ALTER TABLE public.outlet_events
  DROP COLUMN IF EXISTS controllo_moda, DROP COLUMN IF EXISTS regole_origine, DROP COLUMN IF EXISTS regole, DROP COLUMN IF EXISTS tipo;
DROP TABLE IF EXISTS public.employee_riposi;
ALTER TABLE public.outlet_shift_rules DROP CONSTRAINT IF EXISTS outlet_shift_rules_caldi_ore_apertura_check;
ALTER TABLE public.outlet_shift_rules DROP CONSTRAINT IF EXISTS outlet_shift_rules_caldi_fasce_festivi_check;
ALTER TABLE public.outlet_shift_rules DROP CONSTRAINT IF EXISTS outlet_shift_rules_riposi_min_settimana_check;
ALTER TABLE public.outlet_shift_rules
  DROP COLUMN IF EXISTS caldi_ore_apertura, DROP COLUMN IF EXISTS caldi_guida_apre_chiude, DROP COLUMN IF EXISTS caldi_fasce_festivi,
  DROP COLUMN IF EXISTS caldi_straordinari, DROP COLUMN IF EXISTS caldi_tutti_al_lavoro, DROP COLUMN IF EXISTS straordinari_pari,
  DROP COLUMN IF EXISTS riposi_min_settimana;
-- La funzione del fabbisogno degli eventi torna quella della 319 (prima di togliere la colonna regole).
CREATE OR REPLACE FUNCTION public.outlet_events_fabbisogno()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.persone_extra, 0) <> COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.persone_extra END, 0)
     AND NOT public.organico_puo_decidere_fabbisogno() THEN
    RAISE EXCEPTION 'Le persone in piu'' di un evento sono fabbisogno: le decide solo la direzione (profilo Super Advisor).';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
COMMIT;
