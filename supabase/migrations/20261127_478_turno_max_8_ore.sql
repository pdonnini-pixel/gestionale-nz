-- Turno massimo 8 ore lavorate + 30 minuti di pausa nei giorni feriali (Patrizio, 27/11/2026).
-- Oltre le 8 ore, fino a 10, solo nei giorni speciali (sabato, domenica, festivi, eventi, giorni
-- speciali del calendario): lo dice il codice (lunediFisso.ts, TURNO_MAX_SPECIALI_ORE) e la pagina
-- lo segnala come deroga. Qui si porta a 8 il turno massimo salvato nelle regole dei negozi che
-- avevano il valore di base (10) e il valore di base per i negozi nuovi.
-- Prima: tutti i negozi di NZ (8) e di Zago (2) a 10. Vale per NZ e Zago.
BEGIN;
UPDATE public.outlet_shift_rules SET turno_max_ore = 8, updated_at = now() WHERE turno_max_ore = 10;
ALTER TABLE public.outlet_shift_rules ALTER COLUMN turno_max_ore SET DEFAULT 8;
COMMIT;
