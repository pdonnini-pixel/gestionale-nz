-- 325 · Pausa di un'ora da 8 ore di lavoro (Patrizio, 21/10/2026)
--
-- Sostituisce la 318 (30 minuti anche a 8 ore). La pausa non si paga mai:
-- 7 ore di presenza = 6 lavorate e 30', 9 ore di presenza = 8 lavorate e un'ora.
-- Nessun negozio ha regole salvate: cambia solo il valore di partenza.
ALTER TABLE public.outlet_shift_rules ALTER COLUMN pausa_lunga_minuti SET DEFAULT 60;
COMMENT ON COLUMN public.outlet_shift_rules.pausa_lunga_minuti IS
  'Minuti di pausa da pausa_lunga_oltre_ore ore lavorate (8): un''ora, in aggiunta alle ore lavorate e non pagata.';
