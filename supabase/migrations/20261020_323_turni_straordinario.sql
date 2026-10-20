-- 323 · Turni segnati come straordinario (Patrizio, 20/10/2026)
--
-- Nel piano del mese la responsabile HR (Patrizio, Lilian, Veronica) apre una
-- casella e mette, sposta o toglie un turno. Se, parlando con la dipendente,
-- concordano ore in piu', il turno si segna come straordinario: si conta a
-- parte nel riepilogo «Ore del mese» e non copre le ore di contratto.
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS straordinario boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.shifts.straordinario IS
  'Turno concordato come straordinario: nel riepilogo del mese si conta a parte e non riduce le ore di contratto non usate.';
