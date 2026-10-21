-- 324 · Ore di straordinario del singolo turno (Patrizio, 21/10/2026)
--
-- Se un turno si allunga di un'ora e quell'ora e' straordinario, straordinario
-- e' solo quell'ora, non tutto il turno. shifts.ore_straordinario dice quante
-- ore del turno sono straordinario (0 = nessuna); shifts.straordinario resta
-- come «il turno contiene straordinario» (ore_straordinario > 0).
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS ore_straordinario numeric(4,2) NOT NULL DEFAULT 0
  CHECK (ore_straordinario >= 0 AND ore_straordinario <= 24);
COMMENT ON COLUMN public.shifts.ore_straordinario IS
  'Ore del turno che sono straordinario (0 = nessuna). Le altre ore del turno sono ordinarie e coprono il contratto.';
