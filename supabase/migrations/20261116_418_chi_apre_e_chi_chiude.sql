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
