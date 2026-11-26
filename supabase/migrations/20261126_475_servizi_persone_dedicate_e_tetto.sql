-- 475 · Servizi negozi: persone dedicate e tetto di persone nella giornata (Patrizio, 26/11/2026)
--
-- - outlet_servizi.dedicate: le persone dedicate a quel servizio in quel giorno (scarico del
--   martedi', pulizie del lunedi'...). Devono esserci «possibilmente»: il motore le preferisce
--   quando ha la scelta, ma non le aggiunge alle persone che servono. Una dedicata che quel giorno
--   «non riposa mai» (employee_riposi.mai) conta una volta sola, non due.
-- - outlet_shift_rules.tetto_persone_giorno / tetto_giorni: al massimo N persone diverse nella
--   giornata nei giorni scelti (scelta del negozio, spenta = NULL). Non vale nei giorni caldi, nei
--   festivi, negli eventi e nel lunedi' a due (che ha il suo tetto). Nei feriali gli straordinari
--   sono gia' vietati: se con N persone le ore di contratto non bastano, il tetto cede.
-- NUMERO: scritta e applicata su NZ e Zago come «20261126_471_servizi_persone_dedicate_e_tetto» mentre
-- un altro lavoro usava gia' il 471 su main; nel repository e' la 475. Sui database il nome registrato
-- resta quello (e i commenti delle colonne dicono «migration 471»): stessa migration.
-- NO DATA LOSS: solo ADD COLUMN. ROLLBACK: _ROLLBACK.

BEGIN;

ALTER TABLE public.outlet_servizi ADD COLUMN IF NOT EXISTS dedicate uuid[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.outlet_servizi.dedicate IS
  'Persone dedicate al servizio (employees.id): il piano le preferisce quando ha la scelta (migration 471).';

ALTER TABLE public.outlet_shift_rules ADD COLUMN IF NOT EXISTS tetto_persone_giorno smallint
  CHECK (tetto_persone_giorno IS NULL OR tetto_persone_giorno BETWEEN 2 AND 10);
ALTER TABLE public.outlet_shift_rules ADD COLUMN IF NOT EXISTS tetto_giorni smallint[];
COMMENT ON COLUMN public.outlet_shift_rules.tetto_persone_giorno IS
  'Al massimo queste persone diverse nella giornata, nei giorni di tetto_giorni (1 = lunedi''). NULL = spento (migration 471).';

COMMIT;

-- VERIFICA:
--   SELECT column_name FROM information_schema.columns
--    WHERE (table_name, column_name) IN (('outlet_servizi','dedicate'),('outlet_shift_rules','tetto_persone_giorno'),('outlet_shift_rules','tetto_giorni'));  -- 3 righe
