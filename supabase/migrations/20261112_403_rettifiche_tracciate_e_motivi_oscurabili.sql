-- =====================================================================
-- Migrazione 403 — Rettifiche tracciate e motivi oscurabili
-- =====================================================================
-- Pacchetto privacy (documento 06, 11/11/2026), correzioni di priorità alta
-- chieste da Patrizio il 12/11/2026:
-- 1. attendance_rettifiche: storico solo in aggiunta di ogni modifica a
--    timbrature e casi (chi, quando, prima e dopo). Lo scrivono due trigger,
--    quindi vale per ogni strada (gestionale, app, telefono del negozio,
--    funzioni del server). Chiude i tre buchi trovati: correzione dell'ora
--    di un'entrata segnata, conferma dalla giornata, riapertura di un caso.
--    I testi scritti dal dipendente NON si copiano nello storico (si segna
--    solo che sono cambiati), così l'oscuramento resta tale.
-- 2. presenze_oscura_motivo / timbrature_oscura_nota: chi gestisce le
--    presenze svuota un motivo o la nota di una timbratura segnata dal
--    dipendente (per esempio con dati sulla salute), con il perché
--    obbligatorio. Restano chi, quando e perché; il testo no.
-- 3. presenze_storico: lo storico di un caso e della sua timbratura, con i
--    nomi, per chi può confermare quel negozio.
-- Tenant: NZ e Zago. Rollback: 20261112_403_rettifiche_tracciate_e_motivi_oscurabili_ROLLBACK.sql
-- =====================================================================
BEGIN;

ALTER TABLE public.attendance_eventi ADD COLUMN IF NOT EXISTS motivo_oscurato_il timestamptz;
ALTER TABLE public.attendance_eventi ADD COLUMN IF NOT EXISTS motivo_oscurato_da uuid;
ALTER TABLE public.attendance_eventi ADD COLUMN IF NOT EXISTS motivo_oscurato_perche text;
ALTER TABLE public.attendance_punches ADD COLUMN IF NOT EXISTS nota_oscurata_il timestamptz;
ALTER TABLE public.attendance_punches ADD COLUMN IF NOT EXISTS nota_oscurata_da uuid;
ALTER TABLE public.attendance_punches ADD COLUMN IF NOT EXISTS nota_oscurata_perche text;

-- 1. Storico delle rettifiche
CREATE TABLE IF NOT EXISTS public.attendance_rettifiche (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  outlet_id   uuid,
  employee_id uuid,
  tabella     text NOT NULL CHECK (tabella IN ('timbratura', 'caso')),
  riga_id     uuid NOT NULL,
  azione      text NOT NULL,
  prima       jsonb,
  dopo        jsonb,
  autore      uuid,
  il          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_rettifiche_riga_idx ON public.attendance_rettifiche (riga_id, il);
CREATE INDEX IF NOT EXISTS attendance_rettifiche_company_idx ON public.attendance_rettifiche (company_id, il);

ALTER TABLE public.attendance_rettifiche ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rettifiche_lettura ON public.attendance_rettifiche;
CREATE POLICY rettifiche_lettura ON public.attendance_rettifiche FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.timbrature_gestore()));
-- Solo lettura dall'API: scrivono soltanto i trigger
REVOKE ALL ON public.attendance_rettifiche FROM anon, authenticated;
GRANT SELECT ON public.attendance_rettifiche TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_rettifiche TO service_role;

CREATE OR REPLACE FUNCTION public.attendance_rettifiche_timbratura()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_prima jsonb := '{}'::jsonb;
  v_dopo  jsonb := '{}'::jsonb;
  v_azione text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Solo le timbrature aggiunte a mano (le altre nascono dalla timbratura stessa)
    IF NEW.origine IS DISTINCT FROM 'manuale' THEN RETURN NEW; END IF;
    INSERT INTO public.attendance_rettifiche (company_id, outlet_id, employee_id, tabella, riga_id, azione, dopo, autore)
    VALUES (NEW.company_id, NEW.outlet_id, NEW.employee_id, 'timbratura', NEW.id, 'aggiunta a mano',
            jsonb_build_object('tipo', NEW.tipo, 'ora', NEW.ora, 'nota', NEW.nota), (SELECT auth.uid()));
    RETURN NEW;
  END IF;

  IF NEW.ora IS DISTINCT FROM OLD.ora THEN
    v_prima := v_prima || jsonb_build_object('ora', OLD.ora); v_dopo := v_dopo || jsonb_build_object('ora', NEW.ora);
  END IF;
  IF NEW.tipo IS DISTINCT FROM OLD.tipo THEN
    v_prima := v_prima || jsonb_build_object('tipo', OLD.tipo); v_dopo := v_dopo || jsonb_build_object('tipo', NEW.tipo);
  END IF;
  IF NEW.verifica IS DISTINCT FROM OLD.verifica THEN
    v_prima := v_prima || jsonb_build_object('verifica', OLD.verifica); v_dopo := v_dopo || jsonb_build_object('verifica', NEW.verifica);
  END IF;
  IF NEW.annullata IS DISTINCT FROM OLD.annullata THEN
    v_prima := v_prima || jsonb_build_object('annullata', OLD.annullata);
    v_dopo := v_dopo || jsonb_build_object('annullata', NEW.annullata, 'motivo', NEW.annullata_motivo);
  END IF;
  IF NEW.nota IS DISTINCT FROM OLD.nota THEN
    -- Il testo non si copia: puo' contenere quello che il dipendente ha scritto
    v_dopo := v_dopo || jsonb_build_object('nota', CASE WHEN NEW.nota IS NULL THEN 'tolta' ELSE 'cambiata' END);
  END IF;
  IF NEW.nota_oscurata_il IS DISTINCT FROM OLD.nota_oscurata_il AND NEW.nota_oscurata_il IS NOT NULL THEN
    v_dopo := v_dopo || jsonb_build_object('perche', NEW.nota_oscurata_perche);
  END IF;
  IF v_dopo = '{}'::jsonb THEN RETURN NEW; END IF;

  v_azione := CASE
    WHEN NEW.nota_oscurata_il IS DISTINCT FROM OLD.nota_oscurata_il AND NEW.nota_oscurata_il IS NOT NULL THEN 'nota oscurata'
    WHEN NEW.annullata AND NOT OLD.annullata THEN 'annullata'
    WHEN NEW.ora IS DISTINCT FROM OLD.ora THEN 'ora corretta'
    WHEN NEW.verifica IS DISTINCT FROM OLD.verifica THEN 'verifica: ' || OLD.verifica || ' → ' || NEW.verifica
    ELSE 'modificata' END;
  INSERT INTO public.attendance_rettifiche (company_id, outlet_id, employee_id, tabella, riga_id, azione, prima, dopo, autore)
  VALUES (NEW.company_id, NEW.outlet_id, NEW.employee_id, 'timbratura', NEW.id, v_azione, v_prima, v_dopo, (SELECT auth.uid()));
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.attendance_rettifiche_timbratura() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.attendance_rettifiche_caso()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_prima jsonb := '{}'::jsonb;
  v_dopo  jsonb := '{}'::jsonb;
  v_azione text;
  c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['stato', 'esito', 'deciso_da', 'deciso_il', 'nota_decisione', 'minuti_confermati',
                           'scala_permesso', 'causale', 'leave_request_id'] LOOP
    IF to_jsonb(NEW) -> c IS DISTINCT FROM to_jsonb(OLD) -> c THEN
      v_prima := v_prima || jsonb_build_object(c, to_jsonb(OLD) -> c);
      v_dopo := v_dopo || jsonb_build_object(c, to_jsonb(NEW) -> c);
    END IF;
  END LOOP;
  IF NEW.motivo_dipendente IS DISTINCT FROM OLD.motivo_dipendente THEN
    -- Il testo non si copia: si segna solo che e' cambiato
    v_dopo := v_dopo || jsonb_build_object('motivo', CASE WHEN NEW.motivo_dipendente IS NULL THEN 'tolto' ELSE 'cambiato' END);
  END IF;
  IF NEW.motivo_oscurato_il IS DISTINCT FROM OLD.motivo_oscurato_il AND NEW.motivo_oscurato_il IS NOT NULL THEN
    v_dopo := v_dopo || jsonb_build_object('perche', NEW.motivo_oscurato_perche);
  END IF;
  IF v_dopo = '{}'::jsonb THEN RETURN NEW; END IF;

  v_azione := CASE
    WHEN NEW.motivo_oscurato_il IS DISTINCT FROM OLD.motivo_oscurato_il AND NEW.motivo_oscurato_il IS NOT NULL THEN 'motivo oscurato'
    WHEN OLD.stato <> 'da_confermare' AND NEW.stato = 'da_confermare' THEN 'riaperto'
    WHEN OLD.stato = 'da_confermare' AND NEW.stato <> 'da_confermare' THEN 'deciso: ' || NEW.stato
    WHEN NEW.causale IS DISTINCT FROM OLD.causale THEN 'motivo scelto'
    WHEN NEW.motivo_dipendente IS DISTINCT FROM OLD.motivo_dipendente THEN 'testo del dipendente'
    ELSE 'modificato' END;
  INSERT INTO public.attendance_rettifiche (company_id, outlet_id, employee_id, tabella, riga_id, azione, prima, dopo, autore)
  VALUES (NEW.company_id, NEW.outlet_id, NEW.employee_id, 'caso', NEW.id, v_azione, v_prima, v_dopo, (SELECT auth.uid()));
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.attendance_rettifiche_caso() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rettifiche_timbratura ON public.attendance_punches;
CREATE TRIGGER trg_rettifiche_timbratura AFTER INSERT OR UPDATE ON public.attendance_punches
  FOR EACH ROW EXECUTE FUNCTION public.attendance_rettifiche_timbratura();
DROP TRIGGER IF EXISTS trg_rettifiche_caso ON public.attendance_eventi;
CREATE TRIGGER trg_rettifiche_caso AFTER UPDATE ON public.attendance_eventi
  FOR EACH ROW EXECUTE FUNCTION public.attendance_rettifiche_caso();

-- 2. Oscurare un testo scritto dal dipendente
CREATE OR REPLACE FUNCTION public.presenze_oscura_motivo(p_evento uuid, p_perche text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_perche text := left(NULLIF(btrim(p_perche), ''), 300);
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Solo chi segue il personale può oscurare un motivo.' USING ERRCODE = '42501';
  END IF;
  IF v_perche IS NULL THEN
    RAISE EXCEPTION 'Scrivi perché lo oscuri (per esempio: conteneva dati sulla salute).' USING ERRCODE = '22023';
  END IF;
  UPDATE public.attendance_eventi
     SET motivo_dipendente = NULL, motivo_oscurato_il = now(), motivo_oscurato_da = (SELECT auth.uid()),
         motivo_oscurato_perche = v_perche
   WHERE id = p_evento AND company_id = public.get_my_company_id() AND motivo_dipendente IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Non c''è un motivo da oscurare.' USING ERRCODE = '22023'; END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.presenze_oscura_motivo(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.presenze_oscura_motivo(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.timbrature_oscura_nota(p_punch uuid, p_perche text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_perche text := left(NULLIF(btrim(p_perche), ''), 300);
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Solo chi segue il personale può oscurare una nota.' USING ERRCODE = '42501';
  END IF;
  IF v_perche IS NULL THEN
    RAISE EXCEPTION 'Scrivi perché la oscuri (per esempio: conteneva dati sulla salute).' USING ERRCODE = '22023';
  END IF;
  UPDATE public.attendance_punches
     SET nota = NULL, nota_oscurata_il = now(), nota_oscurata_da = (SELECT auth.uid()), nota_oscurata_perche = v_perche
   WHERE id = p_punch AND company_id = public.get_my_company_id() AND nota IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Non c''è una nota da oscurare.' USING ERRCODE = '22023'; END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.timbrature_oscura_nota(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.timbrature_oscura_nota(uuid, text) TO authenticated, service_role;

-- 3. Storico di un caso e della sua timbratura, con i nomi
CREATE OR REPLACE FUNCTION public.presenze_storico(p_evento uuid)
RETURNS TABLE (il timestamptz, tabella text, azione text, prima jsonb, dopo jsonb, autore text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE ev public.attendance_eventi%ROWTYPE;
BEGIN
  SELECT * INTO ev FROM public.attendance_eventi WHERE id = p_evento;
  IF NOT FOUND OR ev.company_id <> public.get_my_company_id() OR NOT public.presenze_puo_confermare(ev.outlet_id) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.il, r.tabella, r.azione, r.prima, r.dopo,
         COALESCE(NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email,
                  CASE WHEN r.autore IS NULL THEN 'sistema' ELSE 'utente non più presente' END)
    FROM public.attendance_rettifiche r
    LEFT JOIN public.user_profiles u ON u.id = r.autore
   WHERE r.company_id = ev.company_id AND r.riga_id IN (ev.id, ev.punch_id)
   ORDER BY r.il;
END;
$fn$;
REVOKE ALL ON FUNCTION public.presenze_storico(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.presenze_storico(uuid) TO authenticated, service_role;

COMMIT;
