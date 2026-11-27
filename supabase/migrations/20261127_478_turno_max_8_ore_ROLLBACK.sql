-- Rollback della 478: torna il turno massimo di 10 ore (tutti i negozi erano a 10 prima della 478:
-- verificato su NZ e Zago il 27/11/2026) e il controllo originale in turni_proposti_riscrivi.
-- Attenzione: riporta a 10 anche un negozio messo a 8 a mano dopo la 478.
BEGIN;
UPDATE public.outlet_shift_rules SET turno_max_ore = 10, updated_at = now() WHERE turno_max_ore = 8;
ALTER TABLE public.outlet_shift_rules ALTER COLUMN turno_max_ore SET DEFAULT 10;
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.turni_proposti_riscrivi(uuid,date[],jsonb,jsonb)'::regprocedure);
BEGIN
  EXECUTE replace(v_def, 'GREATEST(COALESCE(r.turno_max_ore, 10), 10) INTO v_min, v_max', 'COALESCE(r.turno_max_ore, 10) INTO v_min, v_max');
END $$;
COMMIT;
