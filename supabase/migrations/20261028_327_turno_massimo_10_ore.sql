-- 327 · Turno massimo 10 ore (Patrizio, 28/10/2026)
--
-- «Alza tutti a 10, o a 11 se il negozio fa 11 ore di apertura»: il turno
-- massimo predefinito passa da 8 a 10 ore lavorate. La pausa sta dentro
-- l'orario (lavoroMassimoGiorno nel frontend): 9 + 1 in un negozio aperto 10
-- ore, 10 + 1 in uno aperto 11. Cambia solo il valore predefinito delle righe
-- nuove: le regole gia' salvate restano come sono (al 28/10 solo Franciacorta,
-- gia' a 10). Nessun dato modificato.

ALTER TABLE public.outlet_shift_rules ALTER COLUMN turno_max_ore SET DEFAULT 10;
