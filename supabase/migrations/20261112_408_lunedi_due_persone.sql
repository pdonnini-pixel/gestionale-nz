-- =====================================================================
-- Migrazione 408 — Turni: il lunedi' a due persone, scelta del negozio
-- =====================================================================
-- PERCHE': decisione di Patrizio del 12/11/2026 (ORGANICO_TURNI_NOTES.md, sezione
-- «Lunedi' a due persone, pezzi di settimana, straordinario ricalcolato»). Dopo
-- il weekend pesante il lunedi' lavorano al massimo due persone, e non la
-- stessa coppia da un lunedi' al successivo.
--
-- COSA: outlet_shift_rules.lunedi_due_persone (boolean). NULL = spenta: nessun
-- negozio cambia finche' qualcuno non la accende in «Regole e orari».
-- Dove e' accesa: il lunedi' il fabbisogno non supera due persone, anche se le
-- fasce salvate o il traffico MODA ne chiedono di piu' (la pagina lo segnala);
-- un lunedi' festivo o dentro un evento segue le regole dei giorni caldi, non
-- questo tetto. Resta «mai un giorno con una persona sola»: quindi due esatte.
--
-- TENANT: NZ e Zago (Made non riceve piu' modifiche al database: il frontend
-- funziona anche senza la colonna, la scelta non compare).
-- NO DATA LOSS: solo ADD COLUMN, nessun dato toccato. La tabella esiste gia',
-- RLS, policy e GRANT sono quelli di prima.
-- =====================================================================

BEGIN;

ALTER TABLE public.outlet_shift_rules
  ADD COLUMN IF NOT EXISTS lunedi_due_persone boolean;

COMMENT ON COLUMN public.outlet_shift_rules.lunedi_due_persone IS
  'Il lunedi'' al massimo due persone in turno, coppia diversa da un lunedi'' al successivo (Patrizio, 12/11/2026). NULL = spenta.';

COMMIT;

-- Verifica (su ogni tenant):
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'outlet_shift_rules' AND column_name = 'lunedi_due_persone';  -- boolean, YES
-- SELECT count(*) FROM public.outlet_shift_rules WHERE lunedi_due_persone IS NOT NULL;  -- 0 subito dopo la 408
