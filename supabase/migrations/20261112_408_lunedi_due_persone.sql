-- =====================================================================
-- Migrazione 408 — Turni: il lunedi' a due persone, scelta del negozio;
--                  straordinario scritto a mano; giorno di pubblicazione
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
-- IN PIU' (correzioni dei revisori sul ricalcolo dello straordinario):
--  * shifts.straordinario_a_mano (boolean): true quando lo straordinario l'ha
--    scritto una persona dalla finestra del turno; false quando l'ha scritto il
--    ricalcolo; NULL = proposta del sistema o turni di prima. Il ricalcolo non
--    tocca MAI un turno con true («un valore messo a mano non si sovrascrive»).
--  * shifts.pubblicato_il (timestamptz): quando il turno e' stato pubblicato.
--    Fino a oggi «pubblicato il» era l'ultimo updated_at dei turni pubblicati, e
--    trg_shifts_touch lo sposta a ogni UPDATE: anche quando il sistema riscrive
--    solo lo straordinario. La colonna la tiene un trigger, per ogni scrittore:
--      - il turno diventa pubblicato  -> now()
--      - il turno torna in bozza o si annulla -> NULL
--      - un turno gia' pubblicato prima della 408 (colonna vuota) viene
--        modificato -> prende l'updated_at che aveva prima della modifica.
--    NESSUN BACKFILL: un UPDATE di massa su shifts farebbe scattare
--    trg_shifts_touch (sposterebbe proprio la data che si vuole conservare) e
--    trg_shifts_mese_chiuso (fallirebbe sui mesi chiusi); spegnere i trigger non
--    e' una strada pulita. Chi legge usa coalesce(pubblicato_il, updated_at).
--
-- TENANT: NZ e Zago (Made non riceve piu' modifiche al database: il frontend
-- funziona anche senza la colonna, la scelta non compare).
-- NO DATA LOSS: solo ADD COLUMN e un trigger che scrive la colonna nuova; nessuna
-- riga esistente toccata. Le tabelle esistono gia', RLS, policy e GRANT sono
-- quelli di prima (i GRANT di tabella coprono le colonne nuove).
-- =====================================================================

BEGIN;

ALTER TABLE public.outlet_shift_rules
  ADD COLUMN IF NOT EXISTS lunedi_due_persone boolean;

COMMENT ON COLUMN public.outlet_shift_rules.lunedi_due_persone IS
  'Il lunedi'' al massimo due persone in turno, coppia diversa da un lunedi'' al successivo (Patrizio, 12/11/2026). NULL = spenta.';

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS straordinario_a_mano boolean,
  ADD COLUMN IF NOT EXISTS pubblicato_il timestamptz;

COMMENT ON COLUMN public.shifts.straordinario_a_mano IS
  'true = lo straordinario l''ha scritto una persona dalla finestra del turno: il ricalcolo non lo tocca. false = scritto dal ricalcolo. NULL = proposta del sistema o turni precedenti alla 408.';
COMMENT ON COLUMN public.shifts.pubblicato_il IS
  'Quando il turno e'' stato pubblicato (trigger trg_shifts_pubblicato_il). NULL = non pubblicato, oppure pubblicato prima della 408 e mai piu'' modificato: chi legge usa coalesce(pubblicato_il, updated_at).';

CREATE OR REPLACE FUNCTION public.shifts_pubblicato_il()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.stato IS DISTINCT FROM 'pubblicato' THEN
    NEW.pubblicato_il := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.stato IS DISTINCT FROM 'pubblicato' THEN
    NEW.pubblicato_il := now();
  ELSE
    -- gia' pubblicato: il giorno non si sposta, qualunque cosa cambi nel turno.
    -- Pubblicato prima della 408: vale l'ultimo aggiornamento di prima.
    NEW.pubblicato_il := COALESCE(OLD.pubblicato_il, OLD.updated_at);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.shifts_pubblicato_il() FROM PUBLIC, anon, authenticated;

-- ATTENZIONE AL NOME: i trigger BEFORE partono in ordine alfabetico. Questo deve
-- partire prima di trg_shifts_touch, perche' legge OLD.updated_at ancora vero.
-- Chi rinomina un trigger su shifts controlla che l'ordine resti questo.
DROP TRIGGER IF EXISTS trg_shifts_pubblicato_il ON public.shifts;
CREATE TRIGGER trg_shifts_pubblicato_il
  BEFORE INSERT OR UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.shifts_pubblicato_il();

COMMIT;

-- Verifica (su ogni tenant):
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'outlet_shift_rules' AND column_name = 'lunedi_due_persone';  -- boolean, YES
-- SELECT count(*) FROM public.outlet_shift_rules WHERE lunedi_due_persone IS NOT NULL;  -- 0 subito dopo la 408
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'shifts' AND column_name IN ('straordinario_a_mano', 'pubblicato_il');  -- 2 righe
-- SELECT count(*) FILTER (WHERE straordinario_a_mano IS NOT NULL) AS a_mano, count(*) FILTER (WHERE pubblicato_il IS NOT NULL) AS pubblicati
--   FROM public.shifts;  -- 0 e 0 subito dopo la 408 (nessun backfill)
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.shifts'::regclass AND tgname = 'trg_shifts_pubblicato_il';  -- 1 riga
