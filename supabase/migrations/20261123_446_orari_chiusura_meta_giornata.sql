-- 446 — Orari dei negozi: chiusura di metà giornata (Patrizio, 23/11/2026)
--
-- Forte dei Marmi (Zago) apre 10:00-13:00 e 15:30-19:00: fino a oggi gli orari avevano
-- una sola apertura e una sola chiusura al giorno. Due campi facoltativi, «chiuso dalle»
-- e «chiuso alle», nella settimana tipo e nei giorni speciali. Vuoti = orario continuato,
-- come prima: nessun negozio cambia finché qualcuno non li scrive.
--
-- Solo colonne nuove, nullable, senza backfill. Parità tenant: NZ + Zago (Made fuori).

BEGIN;

ALTER TABLE public.outlet_opening_hours
  ADD COLUMN IF NOT EXISTS chiusura_dalle time,
  ADD COLUMN IF NOT EXISTS chiusura_alle time;

ALTER TABLE public.outlet_special_days
  ADD COLUMN IF NOT EXISTS chiusura_dalle time,
  ADD COLUMN IF NOT EXISTS chiusura_alle time;

-- Tutti e due o nessuno, e la chiusura dentro l'orario di apertura.
ALTER TABLE public.outlet_opening_hours DROP CONSTRAINT IF EXISTS outlet_opening_hours_chiusura_ok;
ALTER TABLE public.outlet_opening_hours ADD CONSTRAINT outlet_opening_hours_chiusura_ok CHECK (
  (chiusura_dalle IS NULL AND chiusura_alle IS NULL)
  OR (chiusura_dalle IS NOT NULL AND chiusura_alle IS NOT NULL AND chiusura_dalle < chiusura_alle
      AND (apre IS NULL OR apre < chiusura_dalle) AND (chiude IS NULL OR chiusura_alle < chiude))
);

ALTER TABLE public.outlet_special_days DROP CONSTRAINT IF EXISTS outlet_special_days_chiusura_ok;
ALTER TABLE public.outlet_special_days ADD CONSTRAINT outlet_special_days_chiusura_ok CHECK (
  (chiusura_dalle IS NULL AND chiusura_alle IS NULL)
  OR (chiusura_dalle IS NOT NULL AND chiusura_alle IS NOT NULL AND chiusura_dalle < chiusura_alle
      AND (apre IS NULL OR apre < chiusura_dalle) AND (chiude IS NULL OR chiusura_alle < chiude))
);

COMMENT ON COLUMN public.outlet_opening_hours.chiusura_dalle IS 'Chiusura di metà giornata: da quest''ora il negozio è chiuso (NULL = orario continuato). Migration 446.';
COMMENT ON COLUMN public.outlet_opening_hours.chiusura_alle IS 'Chiusura di metà giornata: a quest''ora il negozio riapre. Migration 446.';
COMMENT ON COLUMN public.outlet_special_days.chiusura_dalle IS 'Chiusura di metà giornata del giorno speciale (NULL = orario continuato). Migration 446.';
COMMENT ON COLUMN public.outlet_special_days.chiusura_alle IS 'Riapertura dopo la chiusura di metà giornata del giorno speciale. Migration 446.';

COMMIT;
