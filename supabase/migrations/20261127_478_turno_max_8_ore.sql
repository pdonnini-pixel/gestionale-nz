-- Turno massimo 8 ore lavorate + 30 minuti di pausa nei giorni feriali (Patrizio, 27/11/2026).
-- Oltre le 8 ore, fino a 10, solo nei giorni speciali (sabato, domenica, festivi, eventi, giorni
-- speciali del calendario): lo dice il codice (lunediFisso.ts, TURNO_MAX_SPECIALI_ORE) e la pagina
-- lo segnala come deroga. Qui si porta a 8 il turno massimo salvato nelle regole dei negozi che
-- avevano il valore di base (10) e il valore di base per i negozi nuovi.
-- Prima: tutti i negozi di NZ (8) e di Zago (2) a 10. Vale per NZ e Zago.
BEGIN;
UPDATE public.outlet_shift_rules SET turno_max_ore = 8, updated_at = now() WHERE turno_max_ore = 10;
ALTER TABLE public.outlet_shift_rules ALTER COLUMN turno_max_ore SET DEFAULT 8;

-- turni_proposti_riscrivi (411, riscritta dalla 470) rifiuta i turni oltre il turno massimo salvato:
-- con 8 bloccherebbe i turni fino a 10 ore che le regole ammettono nei giorni speciali (revisore del
-- database, 27/11/2026). Il controllo del database resta a 10 (il tetto dei giorni speciali); il tetto
-- di 8 nei feriali lo tiene il motore, che non propone turni più lunghi. Si cambia solo quella riga,
-- come la 470: la guardia in testa alla funzione resta com'è.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.turni_proposti_riscrivi(uuid,date[],jsonb,jsonb)'::regprocedure);
  v_vec text := 'COALESCE(r.turno_max_ore, 10) INTO v_min, v_max';
  v_nuo text := 'GREATEST(COALESCE(r.turno_max_ore, 10), 10) INTO v_min, v_max';
BEGIN
  IF (length(v_def) - length(replace(v_def, v_vec, ''))) / length(v_vec) <> 1 THEN
    RAISE EXCEPTION '478: il controllo del turno massimo in turni_proposti_riscrivi non è quello atteso: non cambio niente';
  END IF;
  EXECUTE replace(v_def, v_vec, v_nuo);
END $$;
COMMIT;

-- VERIFICA: SELECT turno_max_ore, count(*) FROM public.outlet_shift_rules GROUP BY 1;  -- solo 8
-- VERIFICA: SELECT pg_get_functiondef('public.turni_proposti_riscrivi(uuid,date[],jsonb,jsonb)'::regprocedure) LIKE '%GREATEST(COALESCE(r.turno_max_ore, 10), 10)%';  -- true
